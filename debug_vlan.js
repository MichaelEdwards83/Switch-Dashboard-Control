import { Client } from 'ssh2';

const config = {
    host: '172.31.29.5',
    port: 22,
    username: 'admin',
    password: 'FuseFuse123!',
    readyTimeout: 30000,
};

const conn = new Client();

console.log('Connecting...');

conn.on('ready', () => {
    console.log('Client :: ready');
    conn.shell((err, stream) => {
        if (err) throw err;

        let buffer = '';
        let step = 'init';

        stream.on('close', () => {
            conn.end();
            console.log('Done.');
        }).on('data', (data) => {
            const chunk = data.toString();
            console.log(chunk);

            if (chunk.includes('Password:')) {
                stream.write(config.password + '\n');
                return;
            }

            if (step === 'init' && chunk.trim().endsWith('>')) {
                stream.write('enable\n');
                step = 'enabled';
            }

            if (chunk.trim().endsWith('#')) {
                if (step === 'enabled') {
                    stream.write('terminal length 0\n');
                    step = 'term_len';
                } else if (step === 'term_len') {
                    console.log('Sending: show vlan port all');
                    stream.write('show vlan port all\n');
                    step = 'check_vlan_port';
                } else if (step === 'check_vlan_port') {
                    conn.end();
                }
            }
        });
    });
}).on('error', (err) => {
    console.error('Client :: error :: ' + err);
}).connect(config);
