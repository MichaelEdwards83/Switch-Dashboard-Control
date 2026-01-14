import { Client } from 'ssh2';
import dotenv from 'dotenv';
import { createConnection } from 'net';

dotenv.config();

// MOCK FRONTEND REQUEST
// We will test if the backend logic now produces valid commands or just use the backend API directly?
// Since we modified App.jsx, the best test is using the UI via Browser Subagent.
// But we want to do a "Backend Logic" test first to ensure the raw command works in script form, 
// using the EXACT string we put in App.jsx.

const config = {
    host: '172.31.29.12',
    port: 22,
    username: process.env.SWITCH_USER,
    password: process.env.SWITCH_PASS,
    readyTimeout: 30000,
    algorithms: {
        kex: [
            'diffie-hellman-group1-sha1',
            'diffie-hellman-group14-sha1',
            'ecdh-sha2-nistp256',
            'ecdh-sha2-nistp384',
            'ecdh-sha2-nistp521',
            'diffie-hellman-group-exchange-sha256',
            'diffie-hellman-group14-sha256'
        ],
        cipher: [
            'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
            'aes128-cbc', '3des-cbc'
        ],
        serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256']
    }
};

const runTest = async () => {
    const conn = new Client();

    // THE EXACT COMMAND FROM App.jsx we want to verify
    // portName should be "1/0/2" if server.js does its job.
    // We already verified in debug_vlan_change.js that this sequence works manually.
    // This script is just a sanity check that the "blind write" approach functions.

    const portName = "1/0/2";
    const vlanId = "10";
    const command = `configure\ninterface ${portName}\nvlan pvid ${vlanId}\nvlan participation include ${vlanId}\nexit\nexit`;

    console.log("Testing Command Block:\n" + command);

    conn.on('ready', () => {
        console.log('Client :: ready');
        conn.shell((err, stream) => {
            if (err) throw err;

            let step = 'init';
            let buffer = '';

            stream.on('close', () => {
                console.log('Stream :: close');
                conn.end();
            }).on('data', (data) => {
                process.stdout.write(data);
                buffer += data.toString();

                const chunk = data.toString();

                if (chunk.includes('Password:')) {
                    stream.write(config.password + '\n');
                }

                if (step === 'init' && chunk.trim().endsWith('>')) {
                    stream.write('enable\n');
                    step = 'enable';
                }

                if (chunk.trim().endsWith('#') && step === 'enable') {
                    stream.write('terminal length 0\n');
                    step = 'term_len';
                }

                if (chunk.trim().endsWith('#') && step === 'term_len') {
                    // Execute the payload exactly as App.jsx does
                    console.log('--- EXECUTING PAYLOAD ---');
                    stream.write(command + '\n');
                    step = 'executing';
                }

                if (step === 'executing' && chunk.includes('#') && !chunk.includes('Config')) {
                    // We returned to privileged exec mode
                    setTimeout(() => conn.end(), 1000);
                }
            });
        });
    }).connect(config);
};

runTest();
