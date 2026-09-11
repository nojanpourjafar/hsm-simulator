import React, { useState } from 'react';

export default function KeyManager({ keys, onStoreKey, loading }) {
  const [keyId, setKeyId] = useState('');
  const [privateKey, setPrivateKey] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const ok = await onStoreKey(keyId.trim(), privateKey.trim());
    if (ok) {
      setKeyId('');
      setPrivateKey('');
    }
  }

  function generateTestKey() {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    setPrivateKey(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
  }

  return (
    <div className="panel key-manager">
      <div className="panel-header">
        <h2>Keys</h2>
        <p>Store a private key on the device</p>
      </div>

      <form onSubmit={handleSubmit} className="form">
        <div className="form-group">
          <label>Key ID</label>
          <input
            type="text"
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            placeholder="eth_main (max 15 chars)"
            maxLength={15}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label>Private key (64 hex chars)</label>
          <textarea
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="paste a 32 byte hex key, or generate one"
            disabled={loading}
            rows="3"
          />
          <button type="button" className="btn btn-secondary" onClick={generateTestKey} disabled={loading}>
            Generate random key
          </button>
        </div>

        <button type="submit" disabled={loading} className="btn btn-primary">
          {loading ? 'Working...' : 'Store on device'}
        </button>
      </form>

      <div className="keys-list">
        <h3>On device ({keys.length})</h3>
        {keys.length === 0 ? (
          <p className="empty-state">Nothing stored yet</p>
        ) : (
          <ul>
            {keys.map((id) => (
              <li key={id}>
                <span className="key-name">{id}</span>
                <span className="key-status">encrypted</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
