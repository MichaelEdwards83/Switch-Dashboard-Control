import express from 'express';
import cors from 'cors';
import { switches } from './config.js';
import dotenv from 'dotenv';
import axios from 'axios';
import https from 'https';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3002;
const MOCK_MODE = false;

// Ignore self-signed certs
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    minVersion: 'TLSv1'
});

class NetgearConfigAgent {
    constructor(ip, username, password) {
        this.ip = ip;
        this.username = username;
        this.password = password;
        this.baseUrl = `https://${ip}:8443/api/v1`;
        this.token = null;
        this.client = axios.create({
            baseURL: this.baseUrl,
            httpsAgent,
            timeout: 30000,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    async login() {
        try {
            const res = await this.client.post('/login', {
                login: { username: this.username, password: this.password }
            });
            const token = res.data.login?.token;
            if (token) {
                this.token = token;
                this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
                return true;
            }
        } catch (err) {
            console.error(`[${this.ip}] Login failed: ${err.message}`);
        }
        return false;
    }

    async getDeviceInfo() {
        try {
            const res = await this.client.get('/device_info');
            return res.data.deviceInfo; // { serialNumber, model, swVer, ... }
        } catch (err) {
            console.error(`[${this.ip}] Device Info failed: ${err.message}`);
            return null;
        }
    }



    async getPortStats(count = 48) {
        if (!this.token && !(await this.login())) return null;

        // No more offset calculation. We fetch what we can and map based on content.
        // We'll fetch a safe range. If users have 48 ports, we fetch up to 60 just in case 
        // there are backplane ports shifting the IDs.
        const startId = 1;
        const endId = startId + count + 12; // Buffer for potential backplane ports

        const chunks = [];
        for (let i = startId; i <= endId; i += 8) {
            chunks.push(i);
        }

        const allStats = [];

        for (const chunkStart of chunks) {
            try {
                const batchPromises = [];
                const batchEnd = Math.min(chunkStart + 7, endId);

                for (let pid = chunkStart; pid <= batchEnd; pid++) {
                    batchPromises.push(
                        this.client.get(`/sw_portstats?portid=${pid}`).catch(e => null)
                    );
                }

                const results = await Promise.all(batchPromises);
                results.forEach(r => {
                    if (r && r.data && r.data.switchStatsPort) {
                        if (Array.isArray(r.data.switchStatsPort)) {
                            allStats.push(...r.data.switchStatsPort);
                        } else {
                            allStats.push(r.data.switchStatsPort);
                        }
                    }
                });

            } catch (err) {
                console.error(`[${this.ip}] Chunk fetch failed: ${err.message}`);
            }
        }
        return allStats;
    }

    async getVlanInfo(vlanId) {
        try {
            const res = await this.client.get(`/swcfg_vlan?vlanid=${vlanId}`);
            return res.data.switchConfigVlan;
        } catch (err) {
            return null;
        }
    }

    // Helper to find API ID from App ID (Physical ID)
    async getApiIdForPhysical(physId) {
        // We need to scan ports to find the one matching 1/0/{physId}
        // Since we don't store a persistent map in the agent, we might need to fetch or rely on cache.
        // Ideally, we fetch stats/config to find it.
        // For efficiency, we can assume the cache in 'pollSwitch' is up to date, 
        // but this method is called by 'setVlan' which might be standalone.

        // Quick scan strategy:
        // Try guessing ID = physId
        // Try guessing ID = physId + 8 (common offset)
        // Verify with exact check?

        // Better: Fetch a range and find match.
        // This is expensive for a single click, but safe.
        // OR, we rely on the `switchCache` which should be populated by the poller.

        // Let's rely on cache if available, else scan.
        // Actually, let's implement a dynamic scan.
        const stats = await this.getPortStats(52); // Fetch enough to find it
        if (!stats) return physId; // Fallback

        const match = stats.find(p => {
            // Look for Name or Description containing 1/0/{physId}
            const nameStr = p.intfName || p.name || p.interface || p.description || "";
            return nameStr.includes(`1/0/${physId}`);
        });

        if (match) return match.portId;

        // Fallback: If no "1/0/X" found, assume 1:1 or old offset logic?
        // User said "ignore description", meaning ignore "Backplane".
        // If we can't find "1/0/X", maybe we just use ID?
        return physId;
    }

    async setVlan(appPortId, vlanId) {
        if (!this.token && !(await this.login())) throw new Error('Auth failed');
        try {
            const portId = await this.getApiIdForPhysical(appPortId);
            const vId = parseInt(vlanId);

            // 1. Fetch Current PVID
            const getRes = await this.client.get(`/swcfg_port?portid=${portId}`);
            if (getRes.data.resp?.status !== 'success') throw new Error('Failed to fetch port config');
            const config = getRes.data.switchPortConfig;
            const oldPvid = config.portVlanId;

            // 2. Add to New VLAN (Untagged)
            const vRes = await this.client.get(`/swcfg_vlan_membership?vlanid=${vId}`);
            let members = vRes.data.vlanMembership?.portMembers || [];
            if (!members.find(m => m.port === portId)) {
                members.push({ port: portId, tagged: false });
                await this.client.post('/swcfg_vlan_membership', {
                    vlanMembership: { vlanid: vId, portMembers: members }
                });
            }

            // 3. Update PVID
            config.portVlanId = vId;
            config.ID = parseInt(config.ID);
            await this.client.post(`/swcfg_port?portid=${portId}`, { switchPortConfig: config });

            // 4. Remove from Old VLAN
            if (oldPvid !== vId && oldPvid !== 0) {
                await this.removeVlanMember(oldPvid, portId);
            }

            return true;
        } catch (err) {
            console.error(`[${this.ip}] Set VLAN failed: ${err.message}`);
            throw err;
        }
    }

    async cyclePoe(appPortId) {
        if (!this.token && !(await this.login())) throw new Error('Auth failed');
        try {
            const portId = await this.getApiIdForPhysical(appPortId);
            await this.client.post(`/swcfg_port?portid=${portId}`, {
                switchPortConfig: { isPoE: false }
            });
            await new Promise(r => setTimeout(r, 1000));
            await this.client.post(`/swcfg_port?portid=${portId}`, {
                switchPortConfig: { isPoE: true }
            });
            return true;
        } catch (err) {
            console.error(`[${this.ip}] PoE Cycle failed: ${err.message}`);
            throw err;
        }
    }
}

// In-Memory Cache
const switchCache = {};

// Polling Loop
// Helper to determine port count based on model
function getPortCountFromModel(model) {
    if (!model) return 48; // Default
    const m = model.toUpperCase();
    if (m.includes('96X')) return 96;
    if (m.includes('52G')) return 52;
    if (m.includes('48X')) return 48;
    if (m.includes('28G')) return 28;
    if (m.includes('24X')) return 24;
    if (m.includes('12X12F')) return 24;
    if (m.includes('8X8F')) return 16;
    if (m.includes('16X')) return 16;
    return 48; // Fallback
}

async function pollSwitch(sw) {
    console.log(`Polling ${sw.name} (${sw.ip_oob})...`);

    // ... (rest of logic)

    let activeIp = sw.ip_oob;
    let usedChannel = 'oob';
    let oobStatus = false;
    let trunkStatus = false;

    // Check OOB
    const agentOob = new NetgearConfigAgent(sw.ip_oob, process.env.SWITCH_USER, process.env.SWITCH_PASS);
    if (await agentOob.login()) {
        oobStatus = true;
    }

    // Check Trunk if configured
    if (sw.ip_trunk) {
        const agentTrunk = new NetgearConfigAgent(sw.ip_trunk, process.env.SWITCH_USER, process.env.SWITCH_PASS);
        // We only really *need* to login to verify connectivity, but a ping equivalent is better.
        // Login is a safe robust check.
        if (await agentTrunk.login()) {
            trunkStatus = true;
        }
    }

    // Determine active path
    let agent = null;
    if (oobStatus) {
        agent = agentOob; // Already logged in
        activeIp = sw.ip_oob;
        usedChannel = 'oob';
    } else if (trunkStatus) {
        agent = new NetgearConfigAgent(sw.ip_trunk, process.env.SWITCH_USER, process.env.SWITCH_PASS);
        await agent.login(); // Need to login again or reuse? Reuse is complex, just new agent.
        activeIp = sw.ip_trunk;
        usedChannel = 'trunk';
    }

    if (!oobStatus && !trunkStatus) {
        // All paths down
        const currentCache = switchCache[sw.ip_oob] || {};
        switchCache[sw.ip_oob] = {
            ...currentCache,
            connectivity: { oob: false, trunk: false, active: 'none' }
        };
        return;
    }

    // Fetch Data using Active Agent
    const resultAgent = (usedChannel === 'oob') ? agentOob : new NetgearConfigAgent(sw.ip_trunk, process.env.SWITCH_USER, process.env.SWITCH_PASS);
    if (usedChannel === 'trunk' && !resultAgent.token) await resultAgent.login();

    try {
        const deviceInfo = await resultAgent.getDeviceInfo();
        const derivedPortCount = getPortCountFromModel(deviceInfo?.model);
        const portStats = await resultAgent.getPortStats(derivedPortCount); // Use derived count!

        if (deviceInfo && portStats) {
            const portMap = {};
            const foundVlans = new Set();

            portStats.forEach(p => {
                let appId = null;
                const nameStr = p.intfName || p.name || p.interface || "";
                const match = nameStr.match(/1\/0\/(\d+)/);
                if (match) {
                    appId = parseInt(match[1]);
                } else {
                    appId = p.portId;
                }

                if (!appId || appId < 1) return;

                const isUp = p.status === 1 || p.oprState === 1;
                const pvid = (p.vlans && p.vlans.length > 0) ? p.vlans[0] : 1;
                if (p.vlans) p.vlans.forEach(v => foundVlans.add(v));

                portMap[appId] = {
                    id: appId,
                    apiId: p.portId,
                    name: `1/0/${appId}`,
                    description: p.myDesc || p.description || '',
                    up: isUp,
                    poe: p.poeStatus === 1,
                    vlan: pvid,
                    speed: p.speed === 130 ? '1G' : 'Unknown'
                };
            });

            // Update VLAN Map
            const currentCache = switchCache[sw.ip_oob] || {};
            const vlanMap = currentCache.vlanMap || { 1: 'Default' };
            for (const vid of foundVlans) {
                if (!vlanMap[vid]) {
                    const vInfo = await resultAgent.getVlanInfo(vid);
                    if (vInfo) vlanMap[vid] = vInfo.name;
                    else vlanMap[vid] = `VLAN ${vid}`;
                }
            }

            switchCache[sw.ip_oob] = {
                ports: portMap,
                systemName: sw.name,
                systemModel: deviceInfo.model,
                connectivity: {
                    oob: oobStatus,
                    trunk: trunkStatus,
                    active: usedChannel
                },
                vlanMap: vlanMap,
                activeIp: activeIp,
                derivedPortCount: derivedPortCount
            };
        }
    } catch (err) {
        console.error(`[${sw.ip_oob}] Poll Data Error: ${err.message}`);
    }
};

const pollSwitches = async () => {
    // Process in batches of 5 to avoid overwhelming network/server
    const BATCH_SIZE = 5;
    // console.log(`[Polling] Starting batch cycle for ${switches.length} switches...`);

    for (let i = 0; i < switches.length; i += BATCH_SIZE) {
        const batch = switches.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(sw => pollSwitch(sw)));
    }

    // console.log(`[Polling] Cycle complete. Waiting 15s...`);
    setTimeout(pollSwitches, 15000); // 15s wait to allow slow chunked polling
};

// Start Polling
pollSwitches(); // Initial run

// API Routes
app.get('/api/switches', (req, res) => {
    // Send full config including trunk IPs
    res.json(switches);
});

app.get('/api/switch/details', (req, res) => {
    const { ip } = req.query; // This will likely be the OOB ip as unique ID
    if (MOCK_MODE) {
        return res.json({ ports: {}, connectivity: { oob: true, trunk: true, active: 'oob' } });
    }

    const data = switchCache[ip] || { ports: {}, connectivity: { oob: false, trunk: false, active: 'none' } };
    res.json(data);
});

// New Config Endpoints
app.post('/api/vlan/set', async (req, res) => {
    const { ip, port, vlanId } = req.body; // 'ip' is the ID key (OOB IP)

    // Find the switch in config to get the CURRENTLY ACTIVE IP if possible, or probe
    // Actually, switchCache has `activeIp`.

    const cached = switchCache[ip];
    const targetIp = cached?.activeIp || ip; // Use active route or fallback to param

    const agent = new NetgearConfigAgent(targetIp, process.env.SWITCH_USER, process.env.SWITCH_PASS);
    try {
        await agent.setVlan(port, vlanId);

        // Optimistic Cache Update
        if (switchCache[ip] && switchCache[ip].ports && switchCache[ip].ports[port]) {
            switchCache[ip].ports[port].vlan = parseInt(vlanId);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/poe/cycle', async (req, res) => {
    const { ip, port } = req.body;

    const cached = switchCache[ip];
    const targetIp = cached?.activeIp || ip;

    const agent = new NetgearConfigAgent(targetIp, process.env.SWITCH_USER, process.env.SWITCH_PASS);
    try {
        await agent.cyclePoe(port);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/execute', (req, res) => {
    res.status(400).json({ error: "Deprecated. Use /api/vlan/set or /api/poe/cycle" });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Switch Controller API (REST) running on http://0.0.0.0:${PORT}`);
});
