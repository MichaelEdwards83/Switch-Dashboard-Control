import express from 'express';
import cors from 'cors';
import { Client } from 'ssh2';
import dotenv from 'dotenv';
import net from 'net';
import { switches } from './config.js';

dotenv.config();

const app = express();
const PORT = 3002; // Different port than dashboard

app.use(cors());
app.use(express.json());

// MOCK MODE: Set to true via .env if you are testing without real switches
const MOCK_MODE = process.env.MOCK_MODE === 'true';

const executeCommand = (host, command) => {
    if (MOCK_MODE) {
        console.log(`[MOCK] Executing '${command}' on ${host}`);
        return new Promise((resolve) => {
            setTimeout(() => {
                if (command.includes('show poe')) {
                    resolve(`
Interface   AdminOper  Power(W)   Class   Device
---------   ---------  --------   -----   ------
0/1         Enable     30.0       4       Camera-A
0/2         Disable    0.0        0       
0/3         Enable     15.4       3       AccessPoint
           `);
                } else if (command.includes('show sysinfo')) {
                    resolve(`
System Description......... Netgear Managed Switch
System Name................ lb3.bottom.switch
System Location............ Server Room
System Contact............. Admin
System Model Identifier.... M4300-96X
                     `);
                } else if (command.includes('show vlan')) {
                    resolve(`
VLAN ID   VLAN Name         Type
-------   ----------------- -------
1         Default           Default
10        Camera_Net        Static
20        Voice_VoIP        Static
30        Corporate         Static
99        Management        Static
                    `);
                } else {
                    resolve(`Mock output for: ${command}`);
                }
            }, 500);
        });
    }

    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }
                let data = '';
                stream.on('close', (code, signal) => {
                    conn.end();
                    resolve(data);
                }).on('data', (d) => {
                    data += d;
                }).stderr.on('data', (d) => {
                    console.error('STDERR:', d);
                });
            });
        }).on('error', (err) => {
            reject(err);
        }).connect({
            host: host,
            port: 22,
            username: process.env.SWITCH_USER,
            password: process.env.SWITCH_PASS,
            readyTimeout: 5000
        });
    });
};

app.get('/api/switches', (req, res) => {
    res.json(switches);
});

// Helper to generate mock port data
const generateMockPortData = (portCount) => {
    const ports = {};
    for (let i = 1; i <= portCount; i++) {
        const isUp = Math.random() > 0.3;
        ports[i] = {
            id: i,
            up: isUp,
            poe: isUp && Math.random() > 0.7,
            vlan: isUp ? [1, 10, 20, 30, 99][Math.floor(Math.random() * 5)] : null,
            speed: isUp ? '1G' : 'Down'
        };
    }
    return ports;
};

// Generate mock VLAN map
const mockVlanMap = {
    1: 'Default',
    10: 'Camera_Net',
    20: 'Voice_VoIP',
    30: 'Corporate',
    99: 'Management'
};

app.get('/api/switch/details', async (req, res) => {
    const { ip, ports: queryPorts } = req.query;

    if (MOCK_MODE) {
        setTimeout(() => {
            res.json({
                portCount: parseInt(queryPorts) || 48,
                systemName: 'Mock-Switch-01',
                systemModel: 'M4300-48X-Mock',
                ports: generateMockPortData(parseInt(queryPorts) || 48),
                vlanMap: mockVlanMap,
                connectivity: { oob: true, trunk: true, active: 'mock' }
            });
        }, 300);
        return;
    }

    // REAL SSH IMPLEMENTATION
    const oobIp = ip;
    // Derive Trunk IP: 172.31.29.X -> 172.29.10.X
    // Assuming the last octet is always shared
    const lastOctet = ip.split('.').pop();
    const trunkIp = `172.29.10.${lastOctet}`;

    // Helper to check standard TCP port 22 connectivity (fast check)
    const checkPort22 = (host) => {
        return new Promise(resolve => {
            const socket = new net.Socket();
            socket.setTimeout(2000); // 2s timeout
            socket.on('connect', () => { socket.destroy(); resolve(true); });
            socket.on('timeout', () => { socket.destroy(); resolve(false); });
            socket.on('error', () => { socket.destroy(); resolve(false); });
            socket.connect(22, host);
        });
    };

    const runDetails = async (targetIp) => {
        const [statusOutput, poeOutput, sysInfoOutput, vlanOutput] = await Promise.all([
            executeCommand(targetIp, 'show interface status all'),
            executeCommand(targetIp, 'show power inline'),
            executeCommand(targetIp, 'show sysinfo'),
            executeCommand(targetIp, 'show vlan')
        ]);
        return { statusOutput, poeOutput, sysInfoOutput, vlanOutput };
    };

    try {
        // 1. Parallel Connectivity Check
        const [oobAlive, trunkAlive] = await Promise.all([
            checkPort22(oobIp),
            checkPort22(trunkIp)
        ]);

        let activeIp = null;
        if (oobAlive) activeIp = oobIp;
        else if (trunkAlive) activeIp = trunkIp;

        const ports = {};
        // Default to query param if we fail to discover
        let discoveredPortCount = parseInt(queryPorts) || 48;
        let systemName = 'Unknown Switch';
        let systemModel = 'Unknown Model';
        let vlanMap = {};

        if (activeIp) {
            try {
                const { statusOutput, poeOutput, sysInfoOutput, vlanOutput } = await runDetails(activeIp);

                // Parse System Info
                const sysNameMatch = sysInfoOutput.match(/System Name\.+\s+(.+)/i);
                if (sysNameMatch) systemName = sysNameMatch[1].trim();

                const sysModelMatch = sysInfoOutput.match(/System Model Identifier\.+\s+(.+)/i);
                if (sysModelMatch) systemModel = sysModelMatch[1].trim();

                // Parse VLAN Names
                // Expected format:
                // 10        Camera_Net     Static
                const vlanLines = vlanOutput.split('\n');
                vlanLines.forEach(line => {
                    // Match "10    Name    Type"
                    const match = line.match(/^\s*(\d+)\s+([\w\-_]+)\s+/);
                    if (match) {
                        const vid = parseInt(match[1]);
                        const vname = match[2];
                        vlanMap[vid] = vname;
                    }
                });

                // Parse Interface Status & Dynamic Port Count
                const statusLines = statusOutput.split('\n');
                let maxPortId = 0;

                statusLines.forEach(line => {
                    // Match 0/1, 1/0/1 etc.
                    const match = line.match(/^\s*\d+\/(\d+)\s+.*?(Up|Down)\s+(\d+)\s+/i) ||
                        line.match(/^\s*\d+\/\d+\/(\d+)\s+.*?(Up|Down)\s+(\d+)\s+/i);

                    if (match) {
                        const portId = parseInt(match[1]);
                        const status = match[2];
                        const vlan = parseInt(match[3]);

                        // Update max port ID for dynamic counting
                        if (portId > maxPortId) maxPortId = portId;

                        ports[portId] = {
                            id: portId,
                            up: status.toLowerCase() === 'up',
                            vlan: vlan,
                            poe: false // Default to false, update below
                        };
                    }
                });

                // If we found ports, update the count
                if (maxPortId > 0) {
                    discoveredPortCount = maxPortId;
                    for (let i = 1; i <= maxPortId; i++) {
                        if (!ports[i]) ports[i] = { id: i, up: false, poe: false, vlan: null, speed: '' };
                    }
                } else {
                    for (let i = 1; i <= discoveredPortCount; i++) {
                        ports[i] = { id: i, up: false, poe: false, vlan: null, speed: '' };
                    }
                }

                // Parse PoE Status
                const poeLines = poeOutput.split('\n');
                poeLines.forEach(line => {
                    const match = line.match(/^\s*\d+\/(\d+)\s+(Enable|Disable)\s+(On|Off|Searching|Fault)\s+/i) ||
                        line.match(/^\s*\d+\/\d+\/(\d+)\s+(Enable|Disable)\s+(On|Off|Searching|Fault)\s+/i);

                    if (match) {
                        const portId = parseInt(match[1]);
                        const isPowered = match[3].toLowerCase() === 'on';
                        if (ports[portId]) ports[portId].poe = isPowered;
                    }
                });

            } catch (err) {
                console.error(`Failed to scrape data from ${activeIp}:`, err.message);
                for (let i = 1; i <= discoveredPortCount; i++) {
                    if (!ports[i]) ports[i] = { id: i, up: false, poe: false, vlan: null, speed: '' };
                }
            }
        } else {
            for (let i = 1; i <= discoveredPortCount; i++) {
                ports[i] = { id: i, up: false, poe: false, vlan: null, speed: '' };
            }
        }

        res.json({
            portCount: discoveredPortCount,
            systemName,
            systemModel,
            vlanMap,
            ports: ports,
            connectivity: {
                oob: oobAlive,
                trunk: trunkAlive,
                active: activeIp === oobIp ? 'oob' : (activeIp === trunkIp ? 'trunk' : 'none')
            }
        });

    } catch (error) {
        console.error(`System Error for ${ip}:`, error);
        res.status(500).json({ error: error.message, ports: {} });
    }
});

app.post('/api/execute', async (req, res) => {
    const { ip, command } = req.body;

    if (!ip || !command) {
        return res.status(400).json({ error: 'Missing ip or command' });
    }

    try {
        const output = await executeCommand(ip, command);
        res.json({ output });
    } catch (error) {
        console.error(`Command failed on ${ip}:`, error);
        res.status(500).json({ error: 'Command execution failed', details: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Switch Controller API running on http://0.0.0.0:${PORT}`);
});
