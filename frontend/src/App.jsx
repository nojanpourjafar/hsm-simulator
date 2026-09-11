import React, { useState, useEffect } from 'react';
import './App.css';
import StatusPanel from './components/StatusPanel';
import InitPanel from './components/InitPanel';
import KeyManager from './components/KeyManager';
import SigningPanel from './components/SigningPanel';

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
}

export default function App() {
  const [status, setStatus] = useState({ server: 'disconnected', arduino_connected: false });
  const [unlocked, setUnlocked] = useState(false);
  const [keys, setKeys] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const tick = () =>
      api('/api/status')
        .then(setStatus)
        .catch(() => setStatus({ server: 'disconnected', arduino_connected: false }));
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  function notify(msg, isError) {
    setToast((isError ? 'x ' : '') + msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function loadKeys() {
    try {
      const data = await api('/api/hsm/keys');
      setKeys(data.keys || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleInit(password) {
    setBusy(true);
    try {
      await api('/api/hsm/init', { password });
      setUnlocked(true);
      notify('Device unlocked');
      await loadKeys();
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function handleStoreKey(keyId, privateKey) {
    setBusy(true);
    try {
      await api('/api/hsm/store-key', { key_id: keyId, private_key: privateKey });
      notify(`Stored "${keyId}" on the Arduino`);
      await loadKeys();
      return true;
    } catch (e) {
      notify(e.message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSign(keyId, message) {
    setBusy(true);
    try {
      const data = await api('/api/hsm/sign', { key_id: keyId, message });
      notify(`Signed with ${keyId}`);
      return data;
    } catch (e) {
      notify(e.message, true);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleWipe() {
    if (!window.confirm('This erases every key and the master password. Continue?')) return;
    setBusy(true);
    try {
      await api('/api/hsm/wipe', {});
      setUnlocked(false);
      setKeys([]);
      notify('Device wiped');
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>Hardware Security Module</h1>
          <p>Arduino Uno key vault and message signer</p>
        </div>
        <StatusPanel status={status} />
      </header>

      {toast && (
        <div className={`message ${toast.startsWith('x ') ? 'error' : 'success'}`}>
          {toast.replace(/^x /, '')}
        </div>
      )}

      <main className="container">
        {!unlocked ? (
          <InitPanel onInit={handleInit} loading={busy} />
        ) : (
          <div className="panels">
            <KeyManager keys={keys} onStoreKey={handleStoreKey} loading={busy} />
            <SigningPanel keys={keys} onSign={handleSign} loading={busy} />
          </div>
        )}
      </main>

      <footer className="footer">
        <p>
          <a href="https://github.com/nojanpourjafar/hsm-simulator" target="_blank" rel="noopener noreferrer">
            Source
          </a>
          {' · '}
          <button type="button" className="link-btn" onClick={handleWipe} disabled={busy}>
            Factory reset device
          </button>
        </p>
      </footer>
    </div>
  );
}
