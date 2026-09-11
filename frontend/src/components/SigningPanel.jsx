import React, { useState } from 'react';

export default function SigningPanel({ keys, onSign, loading }) {
  const [selectedKey, setSelectedKey] = useState('');
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');

  async function handleSign(e) {
    e.preventDefault();

    if (!selectedKey) {
      alert('Please select a key');
      return;
    }

    if (!message.trim()) {
      alert('Please enter a message to sign');
      return;
    }

    const result = await onSign(selectedKey, message);
    
    if (result) {
      setSignature(result.signature || '');
    }
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(signature);
    alert('Signature copied to clipboard!');
  }

  return (
    <div className="panel signing-panel">
      <div className="panel-header">
        <h2>Sign</h2>
        <p>The key stays on the Arduino, only the signature comes back</p>
      </div>

      <form onSubmit={handleSign} className="form">
        <div className="form-group">
          <label>Select Key</label>
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            disabled={loading || keys.length === 0}
          >
            <option value="">-- Choose a key --</option>
            {keys.map((keyId) => (
              <option key={keyId} value={keyId}>
                {keyId}
              </option>
            ))}
          </select>
          {keys.length === 0 && (
            <p className="form-hint">Store a key first to enable signing</p>
          )}
        </div>

        <div className="form-group">
          <label>Message to Sign</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Enter the message or transaction hash to sign"
            disabled={loading}
            rows="4"
          />
        </div>

        <button
          type="submit"
          disabled={loading || keys.length === 0}
          className="btn btn-primary"
        >
          {loading ? 'Signing...' : 'Sign with HSM'}
        </button>
      </form>

      {signature && (
        <div className="signature-result">
          <h3>Signature</h3>
          <div className="signature-box">
            <code>{signature}</code>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={copyToClipboard}
            >
              Copy to Clipboard
            </button>
          </div>

          <div className="signature-info">
            <p><strong>Algorithm:</strong> HMAC-SHA256</p>
            <p><strong>Length:</strong> {signature.length} hex characters (256-bit)</p>
            <p><strong>Signed on:</strong> Arduino Uno</p>
          </div>
        </div>
      )}

      <div className="info-box">
        <h3>How it works</h3>
        <ol>
          <li>Select a key stored on the Arduino HSM</li>
          <li>Enter the message or transaction hash you want to sign</li>
          <li>Click "Sign with HSM" to send to Arduino</li>
          <li>The private key is never exposed to this web interface</li>
          <li>Arduino signs locally and returns only the signature</li>
        </ol>
      </div>
    </div>
  );
}
