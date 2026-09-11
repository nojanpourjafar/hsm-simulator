import React, { useState } from 'react';

export default function InitPanel({ onInit, loading }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    onInit(password);
  }

  return (
    <div className="panel init-panel">
      <div className="panel-header">
        <h2>Unlock device</h2>
        <p>First time: this sets the master password. After that, it unlocks the device.</p>
      </div>

      <form onSubmit={handleSubmit} className="form">
        <div className="form-group">
          <label>Master Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter a strong password (8+ chars)"
            disabled={loading}
            required
          />
        </div>

        <div className="form-group">
          <label>Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your password"
            disabled={loading}
            required
          />
        </div>

        {error && <div className="error-message">{error}</div>}

        <button type="submit" disabled={loading} className="btn btn-primary">
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
      </form>

      <div className="info-box">
        <h3>What is this?</h3>
        <p>
          This is a Hardware Security Module (HSM) simulator running on an Arduino Uno.
          Your private keys are stored securely in encrypted EEPROM and never leave the device.
        </p>
        <ul>
          <li>Keys are AES-256 encrypted on an external EEPROM</li>
          <li>Signing happens on the board, the key never leaves it</li>
          <li>HMAC-SHA256 signatures</li>
          <li>Talks to this page through a small Node serial bridge</li>
        </ul>
      </div>
    </div>
  );
}
