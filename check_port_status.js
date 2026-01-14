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
    conn.shell((err, stream) => {
        if (err) throw err;
        let step = 'init';
        stream.on('data', (data) => {
            const chunk = data.toString();
            if (chunk.includes('Password:')) stream.write(config.password + '\n');
            if (step === 'init' && chunk.trim().endsWith('>')) {
                stream.write('enable\n');
                step = 'enable';
            }
            if (chunk.trim().endsWith('#') && step === 'enable') {
                stream.write('terminal length 0\n');
                step = 'term_len';
            }
            if (chunk.trim().endsWith('#') && step === 'term_len') {
                stream.write('show port status all\n');
                step = 'show';
            }
            if (step === 'show') {
                process.stdout.write(chunk); // Capture output
                if (chunk.trim().endsWith('#')) {
                    conn.end();
                }
            }
        });
    }).connect(config);
});
