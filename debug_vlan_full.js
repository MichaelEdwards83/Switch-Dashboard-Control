import { Client } from 'ssh2';

const config = {
    host: '172.31.29.5',
    port: 22,
    username: 'admin',
    password: 'FuseFuse123!',
    readyTimeout: 30000,
};

const conn = new Client();

console.log(`Connecting to ${config.host}...`);

const start = Date.now();

conn.on('ready', () => {
    console.log('Client :: ready');
    conn.shell((err, stream) => {
        if (err) throw err;

        let buffer = '';
        let step = 'init';

        // Timeout check
        const timer = setTimeout(() => {
            console.error('TIMEOUT REACHED (60s)');
            conn.end();
        }, 60000);

        stream.on('close', () => {
            clearTimeout(timer);
            conn.end();
            console.log(`Done in ${(Date.now() - start) / 1000}s`);
        }).on('data', (data) => {
            const chunk = data.toString();
            // Don't print everything, just raw length
            // process.stdout.write(chunk); 

            if (chunk.includes('Password:')) {
                stream.write(config.password + '\n');
                return;
            }

            if (step === 'init' && chunk.trim().endsWith('>')) {
                stream.write('enable\n');
                step = 'enabled';
                console.log('-> Enabled');
            }

            if (chunk.trim().endsWith('#')) {
                if (step === 'enabled' || step === 'init') {
                    stream.write('terminal length 0\n');
                    step = 'term_len';
                    console.log('-> Term Len 0');
                } else if (step === 'term_len') {
                    stream.write('show sysinfo\n');
                    step = 'sysinfo_capture';
                    console.log('-> Requesting SysInfo');
                } else if (step === 'sysinfo_capture') {
                    console.log('<- Got SysInfo');
                    stream.write('show port status all\n');
                    step = 'status_capture';
                    console.log('-> Requesting Status All');
                } else if (step === 'status_capture') {
                    console.log('<- Got Status All');
                    stream.write('show poe\n');
                    step = 'poe_capture';
                    console.log('-> Requesting PoE');
                } else if (step === 'poe_capture') {
                    console.log('<- Got PoE');
                    stream.write('show vlan\n');
                    step = 'vlan_capture';
                    console.log('-> Requesting VLAN');
                } else if (step === 'vlan_capture') {
                    console.log('<- Got VLAN');
                    stream.write('show vlan port all\n');
                    step = 'vlan_port_capture';
                    console.log('-> Requesting VLAN Port All (Heavy)');
                } else if (step === 'vlan_port_capture') {
                    console.log('<- Got VLAN Port All');
                    conn.end(); // Done
                }
            }
        });
    });
}).on('error', (err) => {
    console.error('Client :: error :: ' + err);
}).connect(config);
