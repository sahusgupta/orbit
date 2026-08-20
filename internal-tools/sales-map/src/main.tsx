import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SalesMapApp from './SalesMapApp';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Sales map root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <SalesMapApp />
  </StrictMode>
);
