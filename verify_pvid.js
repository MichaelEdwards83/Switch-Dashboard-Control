import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const IP = '172.31.29.12';

async function verifyPvid() {
    console.log(`Checking config of ${IP} Port 2...`);
    const client = axios.create({
        baseURL: `https://${IP}:8443/api/v1`,
        httpsAgent,
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
    });

    try {
        await client.post('/login', {
            login: { username: process.env.SWITCH_USER, password: process.env.SWITCH_PASS }
        }).then(r => client.defaults.headers.common['Authorization'] = `Bearer ${r.data.login.token}`);

        const res = await client.get('/swcfg_port?portid=2');
        console.log('PVID:', res.data.switchPortConfig.portVlanId);

    } catch (err) {
        console.error(err.message);
    }
}

verifyPvid();
