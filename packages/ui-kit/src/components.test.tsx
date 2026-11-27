import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  Button,
  Dialog,
  Notice,
  Skeleton,
  Slider,
  TextField,
  Toggle,
  applyTokens,
  cssVariables,
  injectBaseStyles,
} from './index.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return {
    host,
    rerender: (n: React.ReactNode) => act(() => root.render(n)),
    unmount: () => act(() => root.unmount()),
  };
}

describe('ui-kit', () => {
  it('токены: масштаб и шрифт в границах, применение к корню, одна вставка стилей', () => {
    expect(cssVariables({ uiScale: 2, fontSize: 30 })['--dm-font-size']).toBe('30px');
    expect(cssVariables({ uiScale: 1, fontSize: 14 })).toMatchObject({
      '--dm-font-size': '14px',
      '--dm-space-4': '16px',
      '--dm-amber-500': '#e09a2a',
    });
    expect(cssVariables({ reduceMotion: true })['--dm-motion']).toBe('0ms');
    const root = document.createElement('div');
    applyTokens(root, { uiScale: 0.75 });
    expect(root.style.getPropertyValue('--dm-space-4')).toBe('12px');
    injectBaseStyles();
    injectBaseStyles();
    expect(document.querySelectorAll('#dm-ui-kit')).toHaveLength(1);
  });

  it('кнопка: нажатие, занятость блокирует', () => {
    let clicks = 0;
    const m = mount(<Button onClick={() => clicks++}>Войти</Button>);
    act(() => m.host.querySelector('button')?.click());
    m.rerender(
      <Button busy onClick={() => clicks++}>
        Войти
      </Button>,
    );
    act(() => m.host.querySelector('button')?.click());
    expect(clicks).toBe(1);
    expect(m.host.querySelector('button')?.getAttribute('aria-busy')).toBe('true');
  });

  it('поле: подпись, ошибка связана с полем, ввод', () => {
    let value = '';
    const m = mount(
      <TextField
        label="Email"
        value=""
        onChange={(v) => (value = v)}
        error="Неверный email"
        hint="Например, ясна@почта.рф"
      />,
    );
    const input = m.host.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
    expect(m.host.querySelector('[role=alert]')?.textContent).toBe('Неверный email');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(input, 'a@b.c');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(value).toBe('a@b.c');
  });

  it('переключатель и ползунок в границах', () => {
    let on = false;
    let vol = 0;
    const m = mount(
      <>
        <Toggle label="Без звука" checked={false} onChange={(c) => (on = c)} />
        <Slider
          label="Громкость"
          value={50}
          min={0}
          max={100}
          onChange={(v) => (vol = v)}
          format={(v) => `${v}%`}
        />
      </>,
    );
    act(() => (m.host.querySelector('input[role=switch]') as HTMLInputElement).click());
    expect(on).toBe(true);
    expect(m.host.querySelector('output')?.textContent).toBe('50%');
    const range = m.host.querySelector('input[type=range]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(range, '70');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(vol).toBe(70);
  });

  it('диалог: фокус внутрь, Escape закрывает; уведомления и скелетон', () => {
    let closed = 0;
    const m = mount(
      <Dialog title="Удалить героя" open onClose={() => closed++}>
        <button>Подтвердить</button>
      </Dialog>,
    );
    expect(document.activeElement?.textContent).toBe('Подтвердить');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(closed).toBe(1);
    m.rerender(
      <Dialog title="x" open={false} onClose={() => undefined}>
        y
      </Dialog>,
    );
    expect(m.host.querySelector('[role=dialog]')).toBeNull();
    const n = mount(
      <>
        <Notice tone="error">Сбой</Notice>
        <Notice>Готово</Notice>
        <Skeleton lines={3} />
      </>,
    );
    expect(n.host.querySelector('[role=alert]')?.textContent).toBe('Сбой');
    expect(n.host.querySelector('[role=status]')?.textContent).toBe('Готово');
    expect(n.host.querySelectorAll('.dm-skeleton')).toHaveLength(3);
  });
});
