import React from 'react';
import ReactDOM from 'react-dom/client';
import { ArrowUpRight, Zap } from 'lucide-react';
import AssistantWidget from './AssistantWidget';
import './preview.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main className="preview-page">
      <div className="preview-topbar">
        <a className="preview-brand" href="https://ekt.kz" target="_blank" rel="noreferrer">
          <span>
            ekt<span className="brand-dot">.</span>
          </span>
          <span className="preview-brand-caption">ЭЛЕКТРОКОМПЛЕКТ</span>
        </a>
        <a className="preview-backlink" href="https://ekt.kz" target="_blank" rel="noreferrer">
          На сайт <ArrowUpRight size={15} />
        </a>
      </div>
      <section className="preview-hero">
        <div className="preview-hero-copy">
          <p className="preview-eyebrow">
            <span /> Электротехника для ваших задач
          </p>
          <h1>
            Всё начинается
            <br />
            <span>с энергии.</span>
          </h1>
          <p className="preview-description">
            От одной розетки до большого проекта.
            <br />
            Поможем найти то, что нужно именно вам.
          </p>
          <div className="preview-hero-line" />
          <p className="preview-note">Надёжные решения. Каждый день.</p>
        </div>
        <div className="preview-circuit" aria-hidden="true">
          <div className="circuit-halo" />
          <div className="circuit-loop circuit-loop-one" />
          <div className="circuit-loop circuit-loop-two" />
          <div className="circuit-loop circuit-loop-three" />
          <div className="circuit-loop circuit-loop-four" />
          <div className="circuit-power">
            <Zap size={38} strokeWidth={1.6} />
          </div>
          <span className="circuit-point circuit-point-one" />
          <span className="circuit-point circuit-point-two" />
          <span className="circuit-caption">ЭНЕРГИЯ В КАЖДОЙ ДЕТАЛИ</span>
        </div>
      </section>
      <footer className="preview-footer">
        <span className="preview-footer-dot" />
        <p>
          Нужна помощь с выбором?
          <span>Помощник всегда рядом.</span>
        </p>
      </footer>
      <AssistantWidget />
    </main>
  </React.StrictMode>,
);
