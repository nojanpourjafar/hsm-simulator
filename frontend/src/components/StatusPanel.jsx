import React from 'react';

export default function StatusPanel({ status }) {
  const serverOk = status.server === 'running';
  const arduinoOk = status.arduino_connected;

  return (
    <div className="status-panel">
      <div className={`status-item ${serverOk ? 'online' : 'offline'}`}>
        <span className="status-dot"></span>
        <div>
          <div className="status-label">Server</div>
          <div className="status-value">{status.server === 'running' ? 'Online' : 'Offline'}</div>
        </div>
      </div>

      <div className={`status-item ${arduinoOk ? 'online' : 'offline'}`}>
        <span className="status-dot"></span>
        <div>
          <div className="status-label">Arduino</div>
          <div className="status-value">{arduinoOk ? 'Connected' : 'Disconnected'}</div>
        </div>
      </div>

      <div className="status-item">
        <span className="status-dot info"></span>
        <div>
          <div className="status-label">Platform</div>
          <div className="status-value">{status.platform || 'Unknown'}</div>
        </div>
      </div>
    </div>
  );
}
