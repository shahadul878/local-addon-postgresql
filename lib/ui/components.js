'use strict';

const { styles, buttonStyle, statusPillStyle, progressFillStyle } = require('./styles');

const COPIED_RESET_MS = 1500;
const STATUS_LABEL = Object.freeze({
  running: 'Running',
  stopped: 'Stopped',
  'not-initialized': 'Not initialised',
  'binary-missing': 'Binaries missing',
  unknown: 'Unknown',
});

/** Small presentational building blocks. Built from Local's React instance (passed in). */
function createComponents(React, clipboard) {
  const h = React.createElement;

  function Button({ variant = 'default', disabled = false, onClick, children, title }) {
    return h('button', { type: 'button', style: buttonStyle(variant, disabled), disabled, onClick, title }, children);
  }

  function Card({ title, children }) {
    return h('section', { style: styles.card }, title ? h('h3', { style: styles.cardTitle }, title) : null, children);
  }

  function StatusPill({ status }) {
    return h('span', { style: statusPillStyle(status), role: 'status' }, '●', STATUS_LABEL[status] || status);
  }

  function CopyButton({ value }) {
    const [isCopied, setIsCopied] = React.useState(false);
    React.useEffect(() => {
      if (!isCopied) {
        return undefined;
      }
      const timer = setTimeout(() => setIsCopied(false), COPIED_RESET_MS);
      return () => clearTimeout(timer);
    }, [isCopied]);

    const copy = () => {
      clipboard.writeText(String(value));
      setIsCopied(true);
    };
    return h(Button, { onClick: copy, title: 'Copy to clipboard' }, isCopied ? 'Copied' : 'Copy');
  }

  function ProgressBar({ fraction }) {
    if (fraction === null || fraction === undefined) {
      return null;
    }
    return h('div', { style: styles.progressTrack }, h('div', { style: progressFillStyle(fraction) }));
  }

  function ErrorBanner({ message, onDismiss }) {
    if (!message) {
      return null;
    }
    return h(
      'div',
      { style: styles.error, role: 'alert' },
      h('div', { style: styles.spread }, h('span', null, message), h(Button, { onClick: onDismiss }, 'Dismiss')),
    );
  }

  return { h, Button, Card, StatusPill, CopyButton, ProgressBar, ErrorBanner };
}

module.exports = { createComponents };
