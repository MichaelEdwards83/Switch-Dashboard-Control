import { Client } from 'ssh2';

const config = {
    host: '172.31.29.5',
    port: 22,
    username: 'admin',
    password: 'FuseFuse123!',
    readyTimeout: 30000,
};

const conn = new Client();

conn.on('ready', () => {
    console.log('Client :: ready');
    conn.shell((err, stream) => {
        if (err) throw err;

        let buffer = '';
        let step = 'init';

        stream.on('close', () => {
            conn.end();
        }).on('data', (data) => {
            const chunk = data.toString();
            process.stdout.write(chunk);
            buffer += chunk;

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
                    console.log('\n[Script] Sending: show port status all');
                    stream.write('show port status all\n');
                    step = 'status_all';
                } else if (step === 'status_all') {
                    console.log('\n[Script] Sending: show poe');
                    stream.write('show poe\n');
                    step = 'check_poe';
                } else if (step === 'check_poe') {
                    console.log('\n[Script] Sending: show vlan');
                    stream.write('show vlan\n');
                    step = 'check_vlan';
                } else if (step === 'check_vlan') {
                    conn.end();
                }
            }
        });
    });
}).on('error', (err) => {
    console.error('Client :: error :: ' + err);
}).connect(config);
