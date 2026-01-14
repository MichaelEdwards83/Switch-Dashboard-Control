import { Client } from 'ssh2';

const config = {
    host: '172.31.29.5',
    port: 22,
    username: 'admin',
    password: 'FuseFuse123!',
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
    },
    readyTimeout: 30000,
    debug: (msg) => console.log(`[DEBUG] ${msg}`)
};

const conn = new Client();

conn.on('ready', () => {
    console.log('Client :: ready');

    // Test 1: Simple sysinfo without chaining
    console.log('Running: show sysinfo');
    conn.exec('show sysinfo', (err, stream) => {
        if (err) throw err;
        stream.on('close', (code, signal) => {
            console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
            conn.end();
        }).on('data', (data) => {
            console.log('STDOUT: ' + data);
        }).stderr.on('data', (data) => {
            console.log('STDERR: ' + data);
        });
    });
}).on('error', (err) => {
    console.error('Client :: error :: ' + err);
}).connect(config);
