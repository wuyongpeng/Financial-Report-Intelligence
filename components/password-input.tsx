'use client';

import { useState, type CSSProperties, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function PasswordInput({ style, disabled, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  const {
    width = '100%',
    margin,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    ...inputStyle
  } = (style ?? {}) as CSSProperties;

  return (
    <div
      style={{
        position: 'relative',
        width,
        margin,
        marginTop,
        marginRight,
        marginBottom,
        marginLeft,
      }}
    >
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        style={{
          ...inputStyle,
          width: '100%',
          boxSizing: inputStyle.boxSizing ?? 'border-box',
          paddingRight: 36,
        }}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        title={visible ? '隐藏密码' : '显示密码'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((current) => !current)}
        style={{
          position: 'absolute',
          right: 4,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 28,
          height: 28,
          border: 0,
          padding: 0,
          background: 'transparent',
          color: '#64748b',
          cursor: disabled ? 'default' : 'pointer',
          display: 'grid',
          placeItems: 'center',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 1 0 4.2 4.2" />
      <path d="M9.9 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 3.9" />
      <path d="M6.1 6.1C4 7.7 2.5 10.2 2 12c0 0 3.5 7 10 7 1.5 0 2.9-.3 4.1-.8" />
    </svg>
  );
}
