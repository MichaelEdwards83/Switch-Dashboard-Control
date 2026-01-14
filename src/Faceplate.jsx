import React, { useMemo } from 'react';
import { Cable, Wifi, Power } from 'lucide-react';

export function SwitchFaceplate({ portCount, portData = {}, systemName, systemModel, vlanMap = {}, onPortClick }) {
    // Generate ports
    const ports = useMemo(() => {
        return Array.from({ length: portCount }, (_, i) => ({ id: i + 1, isTop: (i + 1) % 2 !== 0 }));
    }, [portCount]);

    // Use dynamic name/model or fallback
    const displayName = systemName || 'NETGEAR';
    const displayModel = systemModel || `M4300-${portCount}X`;

    const portPairs = useMemo(() => {
        const pairs = [];
        for (let i = 0; i < ports.length; i += 2) pairs.push([ports[i], ports[i + 1]]);
        return pairs;
    }, [ports]);

    // Extract unique VLANs for Legend
    const vlanLegend = useMemo(() => {
        const vlans = new Set();
        Object.values(portData).forEach(p => {
            if (p.vlan) vlans.add(p.vlan);
        });
        return Array.from(vlans).sort((a, b) => a - b);
    }, [portData]);

    const getVlanColor = (vlan) => {
        if (!vlan) return null;
        // Distinct colors for common VLANs, procedural for others
        const colors = {
            1: '#64748b',   // Default (Slate)
            10: '#3b82f6',  // Blue
            20: '#ef4444',  // Red
            30: '#10b981',  // Emerald
            40: '#f59e0b',  // Amber
            99: '#8b5cf6',  // Violet
        };
        return colors[vlan] || `hsl(${vlan * 137.508}, 70%, 45%)`; // Golden angle approximation for distinct colors
    };

    return (
        <div className="faceplate-container">
            <div className="faceplate-header">
                <div className="netgear-branding">
                    <span className="brand">{displayName}</span>
                    <span className="model">{displayModel}</span>
                </div>

                {/* VLAN Legend */}
                <div className="vlan-legend">
                    {vlanLegend.map(vlan => (
                        <div key={vlan} className="legend-item">
                            <div className="legend-swatch" style={{ background: getVlanColor(vlan) }} />
                            <span>VLAN {vlan} {vlanMap[vlan] ? `(${vlanMap[vlan]})` : ''}</span>
                        </div>
                    ))}

                    {/* Connectivity Indicators */}
                    <div className="connectivity-status">
                        <div className="status-item" title="Management Network (172.31.29.x)">
                            <div className={`status-dot ${portData.connectivity?.oob ? 'online' : 'offline'}`} />
                            <span>OOB</span>
                        </div>
                        <div className="status-item" title="Trunk Network (172.29.10.x)">
                            <div className={`status-dot ${portData.connectivity?.trunk ? 'online' : 'offline'}`} />
                            <span>TRUNK</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="ports-wrapper">
                <div className="ports-group-left">
                    <div className="status-leds">
                        <div className="led power active" />
                        <div className="led fan active" />
                    </div>
                </div>

                <div className="ports-grid">
                    {portPairs.map((pair, idx) => (
                        <div key={idx} className="port-column">
                            {pair[0] && <Port id={pair[0].id} isTop={true} data={portData[pair[0].id]} color={getVlanColor(portData[pair[0].id]?.vlan)} onClick={() => onPortClick(pair[0].id)} />}
                            {pair[1] && <Port id={pair[1].id} isTop={false} data={portData[pair[1].id]} color={getVlanColor(portData[pair[1].id]?.vlan)} onClick={() => onPortClick(pair[1].id)} />}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function Port({ id, isTop, data, color, onClick }) {
    const isUp = data?.up || false;
    const hasPoe = data?.poe || false;
    const vlan = data?.vlan;

    const borderColor = color || '#334155';
    const bgColor = color ? `${color}20` : '#0f172a';

    return (
        <div
            className="port-box"
            onClick={onClick}
            title={`Port ${id} - ${vlan ? 'VLAN ' + vlan : 'No Config'}`}
            style={{
                borderColor: borderColor,
                backgroundColor: bgColor,
                boxShadow: color ? `0 0 10px ${color}20` : 'none'
            }}
        >
            <div className={`port-id ${isTop ? 'top' : 'bottom'}`} style={{ color: color || '#64748b' }}>
                {id}
            </div>

            <div className="vlan-display" style={{ color: color || '#475569' }}>
                {vlan || '-'}
            </div>

            <div className="indicators">
                <div className={`ind-link ${isUp ? 'active' : ''}`} />
                <div className={`ind-poe ${hasPoe ? 'active' : ''}`} />
            </div>
        </div>
    );
}
