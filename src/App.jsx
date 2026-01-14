import React, { useState, useEffect } from 'react';
import { Terminal, Network, ShieldCheck, Zap, Settings, X, Server } from 'lucide-react';
import { SwitchFaceplate } from './Faceplate';

function App() {
    const [switches, setSwitches] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedPort, setSelectedPort] = useState(null);
    const [activeSwitchIp, setActiveSwitchIp] = useState(null); // Which switch is being clicked
    const [portData, setPortData] = useState({}); // { [ip]: { ports: {} } }
    const [output, setOutput] = useState('');
    const [isConsoleExpanded, setIsConsoleExpanded] = useState(false);
    const [vlanId, setVlanId] = useState('');

    useEffect(() => {
        fetch('/api/switches')
            .then(res => res.json())
            .then(data => setSwitches(data));
    }, []);

    // Poll for ALL switches
    useEffect(() => {
        const fetchAllDetails = async () => {
            const newData = {};
            await Promise.all(switches.map(async (sw) => {
                try {
                    const res = await fetch(`/api/switch/details?ip=${sw.ip}&ports=${sw.ports || 48}`);
                    const json = await res.json();
                    if (json.ports) {
                        newData[sw.ip] = {
                            ...json.ports,
                            connectivity: json.connectivity,
                            systemName: json.systemName,
                            systemModel: json.systemModel,
                            vlanMap: json.vlanMap
                        };
                    }
                } catch (e) {
                    console.error(`Failed to poll ${sw.ip}`);
                }
            }));
            setPortData(prev => ({ ...prev, ...newData }));
        };

        if (switches.length > 0) {
            fetchAllDetails();
            const interval = setInterval(fetchAllDetails, 5000);
            return () => clearInterval(interval);
        }
    }, [switches]);

    const handlePortClick = (swIp, portId) => {
        setActiveSwitchIp(swIp);
        setSelectedPort(portId);
        setVlanId(portData[swIp]?.[portId]?.vlan || '');
    };

    const runCommand = async (ip, cmd) => {
        setLoading(true);
        setIsConsoleExpanded(true);
        const sw = switches.find(s => s.ip === ip);
        try {
            const res = await fetch('/api/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, command: cmd })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setOutput(prev => `[${sw?.name}] Success: ${cmd}\n` + prev);
        } catch (err) {
            setOutput(prev => `[${sw?.name || ip}] Error: ${err.message}\n` + prev);
        } finally {
            setLoading(false);
        }
    };

    const applyVlan = async () => {
        if (!selectedPort || !vlanId || !activeSwitchIp) return;
        const cmd = `configure\ninterface 0/${selectedPort}\nvlan pvid ${vlanId}\nexit\nexit`;
        await runCommand(activeSwitchIp, cmd);
        setSelectedPort(null);
    };

    const cyclePoe = async () => {
        if (!selectedPort || !activeSwitchIp) return;
        const cmd = `configure\ninterface 0/${selectedPort}\npoe power cycle\nexit\nexit`;
        await runCommand(activeSwitchIp, cmd);
        setSelectedPort(null);
    };

    return (
        <div className="rack-container">
            {/* Rack Header */}
            <div className="rack-header">
                <div className="rack-title">
                    <Server className="icon-emerald" />
                    <h2>Virtual Rack View</h2>
                </div>
            </div>

            <div className="rack-mount-rails">
                {switches.map((sw) => (
                    <div key={sw.ip} className="rack-unit">
                        <SwitchFaceplate
                            portCount={sw.ports || 48}
                            portData={portData[sw.ip]}
                            systemName={portData[sw.ip]?.systemName}
                            systemModel={portData[sw.ip]?.systemModel}
                            vlanMap={portData[sw.ip]?.vlanMap}
                            onPortClick={(pid) => handlePortClick(sw.ip, pid)}
                        />
                    </div>
                ))}
                {switches.length === 0 && (
                    <div className="empty-rack">
                        <span>Loading Rack Units...</span>
                    </div>
                )}
            </div>

            {/* Collapsible Console */}
            <div className={`terminal-window ${isConsoleExpanded ? 'expanded' : 'collapsed'}`}>
                <div className="terminal-header" onClick={() => setIsConsoleExpanded(!isConsoleExpanded)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Terminal size={16} />
                        <span>Activity Log</span>
                    </div>
                    <span>{isConsoleExpanded ? '▼ Minimize' : '▲ Show Details'}</span>
                </div>
                <pre className="terminal-body" style={{ display: isConsoleExpanded ? 'block' : 'none' }}>
                    {output || 'Rack System Ready...'}
                </pre>
            </div>

            {/* Modal */}
            {selectedPort && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h3>Config: {switches.find(s => s.ip === activeSwitchIp)?.name} : Port {selectedPort}</h3>
                            <button className="close-btn" onClick={() => setSelectedPort(null)}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="control-group">
                                <label>Set VLAN ID</label>
                                <div className="input-row">
                                    {portData[activeSwitchIp]?.vlanMap && Object.keys(portData[activeSwitchIp].vlanMap).length > 0 ? (
                                        <select value={vlanId} onChange={(e) => setVlanId(e.target.value)} style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: '4px', color: '#fff', padding: '8px' }}>
                                            <option value="">Select VLAN...</option>
                                            {Object.entries(portData[activeSwitchIp].vlanMap).map(([id, name]) => (
                                                <option key={id} value={id}>
                                                    {id} - {name}
                                                </option>
                                            ))}
                                            {/* Allow keeping current value if not in map */}
                                            {vlanId && !portData[activeSwitchIp].vlanMap[vlanId] && <option value={vlanId}>{vlanId} (Custom)</option>}
                                        </select>
                                    ) : (
                                        <input type="number" value={vlanId} onChange={(e) => setVlanId(e.target.value)} placeholder="VLAN ID" />
                                    )}
                                    <button className="primary-btn" onClick={applyVlan}>Apply</button>
                                </div>
                            </div>
                            <div className="control-group">
                                <label>PoE Control</label>
                                <button className="danger-btn full-width" onClick={cyclePoe}><Zap size={16} /> Reboot Port</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
