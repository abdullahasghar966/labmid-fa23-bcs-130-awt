import React from 'react';
import { createRoot } from 'react-dom/client';
import { initFirebase } from './firebase.js';
import App from './App.jsx';
import './styles.css';

initFirebase().then(() => {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
