import { Client } from 'ssh2';
import dotenv from 'dotenv';

dotenv.config();

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

const conn = new Client();

conn.on('ready', () => {
    console.log('Client :: ready');
    conn.shell((err, stream) => {
        if (err) throw err;

        let step = 'init';

        stream.on('close', () => {
            console.log('Stream :: close');
            conn.end();
        }).on('data', (data) => {
            process.stdout.write(data);

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
                console.log('\n--- ENTERING CONFIG ---\n');
                stream.write('configure\n');
                step = 'config';
            }

            // Match (Config)#
            if (chunk.includes('(Config)#')) {
                if (step === 'config') {
                    console.log('\n--- SELECTING INTERFACE 1/0/2 ---\n');
                    stream.write('interface 1/0/2\n');
                    step = 'interface';
                }
            }

            // Match (Interface 1/0/2)# or similar
            if (chunk.includes('(Interface') && chunk.trim().endsWith('#')) {
                if (step === 'interface') {
                    console.log('\n--- SETTING VLAN 10 ---\n');
                    // According to M4300 docs, it might be:
                    // vlan pvid <id>
                    // vlan participation include <id>
                    stream.write('vlan pvid 10\n');
                    stream.write('vlan participation include 10\n');
                    stream.write('exit\n');
                    step = 'exited_interface';
                }
            }

            // Should return to (Config)#
            if (step === 'exited_interface' && chunk.includes('(Config)#')) {
                stream.write('exit\n');
                step = 'exiting_conf';
            }

            // Should return to #
            if (step === 'exiting_conf' && chunk.trim().endsWith('#') && !chunk.includes('(')) {
                // Verify
                console.log('\n--- VERIFYING ---\n');
                stream.write('show port status 1/0/2\n');
                stream.write('show vlan 10\n');
                step = 'verify';
            }

            if (step === 'verify') {
                // If we see output, good.
                if (chunk.includes('Check_VLAN')) {
                    console.log('\nSAW CHECK VLAN\n');
                }
            }

            // Set a hard timeout to close
            if (step === 'verify') {
                setTimeout(() => conn.end(), 5000);
            }

        });
    });
}).connect(config);
