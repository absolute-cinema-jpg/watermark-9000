import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import * as store from './store.js';
import * as queue from './queue.js';
import * as render from './lib/render.js';
import './styles.css';

store.initStore();
// handy for debugging from DevTools
window.__app = { ...store, ...queue, render };
createRoot(document.getElementById('root')).render(<App />);
