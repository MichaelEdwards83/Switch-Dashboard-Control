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
            const batchSize = 5;

            // Process switches in batches to avoid overwhelming the backend
            for (let i = 0; i < switches.length; i += batchSize) {
                const batch = switches.slice(i, i + batchSize);
                await Promise.all(batch.map(async (sw) => {
                    if (!sw.ip_oob) return;
                    try {
                        const res = await fetch(`/api/switch/details?ip=${sw.ip_oob}&ports=${sw.ports || 48}`);
                        const json = await res.json();
                        if (json.ports || json.connectivity) {
                            newData[sw.ip_oob] = {
                                ...json.ports,
                                connectivity: json.connectivity,
                                systemName: json.systemName,
                                systemModel: json.systemModel,
                                vlanMap: json.vlanMap,
                                derivedPortCount: json.derivedPortCount
                            };
                        }
                    } catch (e) {
                        console.error(`Failed to poll ${sw.ip_oob}`);
                    }
                }));
            }
            // Update state after all batches
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
        setLoading(true);
        setIsConsoleExpanded(true);
        const portId = selectedPort;

        try {
            const res = await fetch('/api/vlan/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: activeSwitchIp, port: portId, vlanId: vlanId })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setOutput(prev => `[${activeSwitchIp}] VLAN ${vlanId} Applied to Port ${portId}\n` + prev);
        } catch (err) {
            setOutput(prev => `[${activeSwitchIp}] VLAN Error: ${err.message}\n` + prev);
        } finally {
            setLoading(false);
            setSelectedPort(null);
        }
    };

    const cyclePoe = async () => {
        if (!selectedPort || !activeSwitchIp) return;
        setLoading(true);
        setIsConsoleExpanded(true);

        try {
            const res = await fetch('/api/poe/cycle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: activeSwitchIp, port: selectedPort })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setOutput(prev => `[${activeSwitchIp}] Port ${selectedPort} Rebooted (PoE Cycle)\n` + prev);
        } catch (err) {
            setOutput(prev => `[${activeSwitchIp}] PoE Error: ${err.message}\n` + prev);
        } finally {
            setLoading(false);
            setSelectedPort(null);
        }
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
                {switches.map((sw) => {
                    const status = portData[sw.ip_oob]?.connectivity || { oob: false, trunk: false, active: 'none' };
                    const cleanName = sw.name.replace('SW-GRN-', '');
                    const pCount = portData[sw.ip_oob]?.derivedPortCount || sw.ports || 48;

                    return (
                        <div key={sw.ip_oob} className="rack-unit">
                            <SwitchFaceplate
                                portCount={pCount}
                                portData={portData[sw.ip_oob] || {}}
                                systemName={cleanName}
                                systemModel={portData[sw.ip_oob]?.systemModel}
                                vlanMap={portData[sw.ip_oob]?.vlanMap || {}}
                                onPortClick={(pid) => handlePortClick(sw.ip_oob, pid)}
                                connectivity={status}
                                ipOob={sw.ip_oob}
                                ipTrunk={sw.ip_trunk}
                            />
                        </div>
                    );
                })}
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
                        <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem', position: 'relative' }}>
                            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#fff' }}>
                                    {switches.find(s => s.ip_oob === activeSwitchIp || s.ip === activeSwitchIp)?.name.replace('SW-GRN-', '')} : Port {selectedPort}
                                </h3>
                                <button className="close-btn" onClick={() => setSelectedPort(null)}><X size={20} /></button>
                            </div>

                            {portData[activeSwitchIp]?.[selectedPort]?.description ? (
                                <div style={{
                                    fontSize: '0.9rem',
                                    color: '#94a3b8',
                                    background: '#1e293b',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid #334155',
                                    marginTop: '4px',
                                    width: '100%',
                                    boxSizing: 'border-box'
                                }}>
                                    {portData[activeSwitchIp]?.[selectedPort]?.description}
                                </div>
                            ) : (
                                <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>No Description</div>
                            )}
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
