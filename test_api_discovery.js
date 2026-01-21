import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const SWITCH_IP = '172.31.29.12'; // SW-GRN-ENG-OP-PLAYBACK
const BASE_URL = `https://${SWITCH_IP}:8443/api/v1`;

const agent = new https.Agent({
    rejectUnauthorized: false // Ignore self-signed certs
});

const client = axios.create({
    baseURL: BASE_URL,
    httpsAgent: agent,
    headers: {
        'Content-Type': 'application/json'
    }
});

async function runTest() {
    try {
        console.log(`Attempting login to ${SWITCH_IP}...`);

        // 1. Login
        const loginPayload = {
            login: {
                username: process.env.SWITCH_USER,
                password: process.env.SWITCH_PASS
            }
        };

        const loginRes = await client.post('/login', loginPayload);
        console.log('Login Response Status:', loginRes.status);

        // Extract Token - Structure is { login: { token: "..." } }
        const token = loginRes.data.login?.token;

        if (token) {
            console.log('Token received:', token);
            // Try Bearer format first, as per standard
            client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        } else {
            console.log('Login Headers:', loginRes.headers);
            console.log('Login Body:', loginRes.data);
            return;
        }

        // 2. Get Device Info
        console.log('\nFetching Device Info...');
        const infoRes = await client.get('/device_info');
        console.log('Device Info:', JSON.stringify(infoRes.data, null, 2));

        // 3. Get VLANs (Try 'all' query)
        console.log('\nFetching VLANs (vlanid=all)...');
        try {
            const vlanRes = await client.get('/swcfg_vlan?vlanid=all');
            console.log('VLAN List:', JSON.stringify(vlanRes.data, null, 2).substring(0, 500) + '...');
        } catch (e) {
            console.log('Failed to list VLANs (vlanid=all):', e.response?.status);
        }

        // 4. Get Port Stats (Try 'ALL' query as per YAML)
        console.log('\nFetching Port Stats (portid=ALL)...');
        try {
            const statsRes = await client.get('/sw_portstats?portid=ALL');
            // Log first 2 items to see structure
            const dataStr = JSON.stringify(statsRes.data, null, 2);
            console.log('Port Stats (ALL):', dataStr.substring(0, 1000));
        } catch (e) {
            console.log('Failed to get Port Stats (portid=ALL):', e.response?.status);
        }

        // Try monitoring endpoint if config fails?
        // /swcfg_port_monitoring is often used for stats
        console.log('\nFetching Port Monitoring (portid=all)...');
        try {
            const monRes = await client.get('/swcfg_port_monitoring?portid=all');
            console.log('Port Monitoring:', JSON.stringify(monRes.data, null, 2).substring(0, 500));
        } catch (e) {
            console.log('Failed Port Monitoring:', e.response?.status);
        }

    } catch (err) {
        console.error('API Test Failed:', err.message);
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
        }
    }
}

runTest();
