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

const getSSHConfig = (host) => ({
    host: host,
    port: 22,
    username: process.env.SWITCH_USER, // e.g., 'admin'
    password: process.env.SWITCH_PASS, // e.g., 'FuseFuse123!'
    agent: false,
    tryKeyboard: true,
    // debug: (msg) => console.log(`[SSH Debug] ${msg}`), // Verbose logging disabled for prod cleanup
    readyTimeout: 30000,
    keepaliveInterval: 10000,
    algorithms: {
        kex: [
            'diffie-hellman-group1-sha1',
            'diffie-hellman-group14-sha1',
            'ecdh-sha2-nistp256',
            'ecdh-sha2-nistp384',
            'ecdh-sha2-nistp521',
            'diffie-hellman-group-exchange-sha256',
            'diffie-hellman-group14-sha256',
            'curve25519-sha256',
            'curve25519-sha256@libssh.org'
        ],
        cipher: [
            'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
            'aes128-cbc', '3des-cbc',
            'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com'
        ],
        serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ssh-ed25519']
    }
});

// Helper to run a sequence of commands in a Shell session
const runShellSequence = (host) => {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        const config = getSSHConfig(host);

        // Collected outputs
        let sysInfoOutput = '';
        let statusAllOutput = '';
        let poeOutput = '';
        let vlanOutput = '';
        let vlanPortOutput = '';

        // State machine
        // init -> enabled -> term_len -> sysinfo -> status -> poe -> vlan -> vlan_port_capture -> done
        let step = 'init';

        let timeout = setTimeout(() => {
            conn.end();
            reject(new Error('Shell session timed out'));
        }, 60000); // Increased timeout for extra command

        conn.on('ready', () => {
            conn.shell((err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                stream.on('close', () => {
                    clearTimeout(timeout);
                    conn.end();
                    resolve({ sysInfoOutput, statusAllOutput, poeOutput, vlanOutput, vlanPortOutput });
                }).on('data', (data) => {
                    const chunk = data.toString();

                    // Capture data based on step
                    if (step === 'sysinfo_capture') sysInfoOutput += chunk;
                    if (step === 'status_capture') statusAllOutput += chunk;
                    if (step === 'poe_capture') poeOutput += chunk;
                    if (step === 'vlan_capture') vlanOutput += chunk;
                    if (step === 'vlan_port_capture') vlanPortOutput += chunk;

                    // Handle Prompts
                    if (chunk.includes('Password:')) {
                        stream.write(config.password + '\n');
                        return;
                    }

                    // Check for User Mode >
                    if (step === 'init' && chunk.trim().endsWith('>')) {
                        stream.write('enable\n');
                        step = 'enabled';
                    }

                    // Check for Privileged Mode #
                    if (chunk.trim().endsWith('#')) {
                        if (step === 'enabled' || step === 'init') {
                            stream.write('terminal length 0\n');
                            step = 'term_len';
                        } else if (step === 'term_len') {
                            stream.write('show sysinfo\n');
                            step = 'sysinfo_capture';
                        } else if (step === 'sysinfo_capture') {
                            stream.write('show port status all\n');
                            step = 'status_capture';
                        } else if (step === 'status_capture') {
                            stream.write('show poe\n');
                            step = 'poe_capture';
                        } else if (step === 'poe_capture') {
                            stream.write('show vlan\n');
                            step = 'vlan_capture';
                        } else if (step === 'vlan_capture') {
                            stream.write('show vlan port all\n');
                            step = 'vlan_port_capture';
                        } else if (step === 'vlan_port_capture') {
                            conn.end(); // Done
                        }
                    }
                });
            });
        })
            .on('error', (err) => {
                clearTimeout(timeout);
                console.error(`[SSH Error] Connection to ${host} failed:`, err.message);
                reject(err);
            })
            .connect(config);
    });
};

const fetchSwitchData = async (host) => {
    if (MOCK_MODE) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve({
                    statusOutput: `0/1 Enable Auto 100 Full Up\n0/2 Enable Auto 100 Full Down`,
                    poeOutput: `0/1 Enable On\n`,
                    sysInfoOutput: `System Name......... Mock-Switch-01\nSystem Model Identifier.... M4300-48X-Mock`,
                    vlanOutput: ``,
                    vlanPortOutput: ``
                });
            }, 300);
        });
    }

    try {
        console.log(`[SSH] Connecting to ${host}...`);
        const { sysInfoOutput, statusAllOutput, poeOutput, vlanOutput, vlanPortOutput } = await runShellSequence(host);
        console.log(`[SSH Success] Scraped data from ${host}. SysInfo len: ${sysInfoOutput.length}`);
        return { statusOutput: statusAllOutput, poeOutput, sysInfoOutput, vlanOutput, vlanPortOutput };
    } catch (err) {
        console.error(`[SSH Failed] ${host}: ${err.message}`);
        throw err;
    }
};

// Helper to execute a configuration command via Shell
const runConfigCommand = (host, command) => {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        const config = getSSHConfig(host);

        let output = '';
        let step = 'init';

        // 30s timeout for config changes
        let timeout = setTimeout(() => {
            conn.end();
            reject(new Error('Config session timed out'));
        }, 30000);

        conn.on('ready', () => {
            conn.shell((err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                stream.on('close', () => {
                    clearTimeout(timeout);
                    conn.end();
                    resolve(output);
                }).on('data', (data) => {
                    const chunk = data.toString();
                    output += chunk;

                    if (chunk.includes('Password:')) {
                        stream.write(config.password + '\n');
                        return;
                    }

                    if (step === 'init' && chunk.trim().endsWith('>')) {
                        stream.write('enable\n');
                        step = 'enabled';
                    }

                    if (chunk.trim().endsWith('#')) {
                        if (step === 'enabled' || step === 'init') {
                            stream.write('terminal length 0\n');
                            step = 'term_len';
                        } else if (step === 'term_len') {
                            // Send the actual command block
                            // Ensure we write it line by line or invalid chars might issue
                            // The command from frontend contains \n
                            console.log(`[SSH Config] Executing on ${host}:\n${command}`);
                            stream.write(command + '\n');
                            step = 'executing';
                        } else if (step === 'executing') {
                            // We got a prompt BACK after executing.
                            // This means command finished (or at least the buffer flushed).
                            // Wait a tiny bit or just close?
                            // M4300 echoes commands, so we see the prompt again.
                            conn.end();
                        }
                    }
                });
            });
        })
            .on('error', (err) => {
                clearTimeout(timeout);
                console.error(`[SSH Error] Config connection to ${host} failed:`, err.message);
                reject(err);
            })
            .connect(config);
    });
};

const executeCommand = async (host, command) => {
    if (MOCK_MODE) {
        console.log(`[Mock Exec] ${host}: ${command}`);
        return "Mock Success";
    }
    return runConfigCommand(host, command);
};

app.post('/api/execute', async (req, res) => {
    const { ip, command } = req.body;
    try {
        const output = await executeCommand(ip, command);
        res.json({ output });
    } catch (err) {
        console.error(`Execute failed on ${ip}:`, err);
        res.status(500).json({ error: err.message });
    }
});

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
            name: `1/0/${i}`,
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
    const lastOctet = ip.split('.').pop();
    const trunkIp = `172.29.10.${lastOctet}`;

    const checkPort22 = (host) => {
        return new Promise(resolve => {
            const socket = new net.Socket();
            socket.setTimeout(2000);
            socket.on('connect', () => { socket.destroy(); resolve(true); });
            socket.on('timeout', () => { socket.destroy(); resolve(false); });
            socket.on('error', () => { socket.destroy(); resolve(false); });
            socket.connect(22, host);
        });
    };

    try {
        const [oobAlive, trunkAlive] = await Promise.all([
            checkPort22(oobIp),
            checkPort22(trunkIp)
        ]);

        let activeIp = null;
        if (oobAlive) activeIp = oobIp;
        else if (trunkAlive) activeIp = trunkIp;

        const ports = {};
        let discoveredPortCount = parseInt(queryPorts) || 48;
        let systemName = 'Unknown Switch';
        let systemModel = 'Unknown Model';
        let vlanMap = {};

        if (activeIp) {
            try {
                const { statusOutput, poeOutput, sysInfoOutput, vlanOutput, vlanPortOutput } = await fetchSwitchData(activeIp);

                // Parse System Info
                const sysNameMatch = sysInfoOutput.match(/System Name\.+\s+(.+)/i);
                if (sysNameMatch) systemName = sysNameMatch[1].trim();

                const sysModelMatch = sysInfoOutput.match(/System Model Identifier\.+\s+(.+)/i) ||
                    sysInfoOutput.match(/System Description\.+\s+([^\,]+)/i);
                if (sysModelMatch) systemModel = sysModelMatch[1].trim();

                // Parse VLAN Names
                // Format: 1       default                          Default
                const vlanLines = vlanOutput.split('\n');
                vlanLines.forEach(line => {
                    const match = line.match(/^\s*(\d+)\s+([\w\-]+)\s+/);
                    if (match) {
                        vlanMap[parseInt(match[1])] = match[2];
                    }
                });

                // Parse VLAN PVIDs
                // Format: Interface PVID ...
                // 1/0/1    10        ...
                const portVlanMap = {};
                const vlanPortLines = vlanPortOutput.split('\n');
                vlanPortLines.forEach(line => {
                    const match = line.match(/^\s*(\d+\/\d+\/\d+|\d+\/\d+)\s+(\d+)\s+/);
                    if (match) {
                        const portStr = match[1];
                        const pvid = parseInt(match[2]);
                        const portId = parseInt(portStr.split('/').pop());
                        portVlanMap[portId] = pvid;
                    }
                });

                // Parse SHOW PORT STATUS ALL
                // Format: 0/1        Enable    Auto       100 Full   Up     Enable Enable Long
                const statusLines = statusOutput.split('\n');
                let maxPortId = 0;

                statusLines.forEach(line => {
                    // Match 0/1 ... Up/Down or 1/0/1 ... Up/Down
                    const match = line.match(/^\s*(\d+\/\d+|\d+\/\d+\/\d+)\s+.*?\s+(Up|Down)\s+/i);

                    if (match) {
                        const portStr = match[1]; // 0/1 or 1/0/1
                        const status = match[2];
                        const portId = parseInt(portStr.split('/').pop()); // 1

                        if (portId > maxPortId) maxPortId = portId;

                        // Use PVID from mapping, default to 1
                        const pvid = portVlanMap[portId] || 1;

                        ports[portId] = {
                            id: portId,
                            name: portStr, // Capture full name e.g. 1/0/1
                            up: status.toLowerCase() === 'up',
                            vlan: pvid, // Default PVID
                            poe: false
                        };
                    }
                });

                if (maxPortId > 0 && maxPortId > discoveredPortCount / 2) {
                    // Only update if looks reasonable
                    discoveredPortCount = maxPortId;
                }

                // Parse PoE Status
                const poeLines = poeOutput.split('\n');
                poeLines.forEach(line => {
                    // 1/0/1 ... On
                    const match = line.match(/^\s*(\d+\/\d+|\d+\/\d+\/\d+)\s+\w+\s+(On|Off|Searching|Fault)\s+/i);
                    if (match) {
                        const portId = parseInt(match[1].split('/').pop());
                        const isPowered = match[2].toLowerCase() === 'on';
                        if (ports[portId]) ports[portId].poe = isPowered;
                    }
                });

                // Ensure all ports exist
                for (let i = 1; i <= discoveredPortCount; i++) {
                    if (!ports[i]) ports[i] = { id: i, name: `1/0/${i}`, up: false, poe: false, vlan: null, speed: '' };
                }

            } catch (err) {
                console.error(`Failed to scrape data from ${activeIp}:`, err.message);
                for (let i = 1; i <= discoveredPortCount; i++) {
                    if (!ports[i]) ports[i] = { id: i, name: `1/0/${i}`, up: false, poe: false, vlan: null, speed: '' };
                }
            }
        } else {
            for (let i = 1; i <= discoveredPortCount; i++) {
                ports[i] = { id: i, name: `1/0/${i}`, up: false, poe: false, vlan: null, speed: '' };
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Switch Controller API running on http://0.0.0.0:${PORT}`);
});
