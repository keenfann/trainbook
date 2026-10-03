// @vitest-environment jsdom
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AnimatedModal from '../src/ui/modal/AnimatedModal.jsx';
import { MotionPreferenceProvider } from '../src/motion-preferences.jsx';

function Editor() {
  const [open, setOpen] = useState(false);
  return <MotionPreferenceProvider>
    <button onClick={() => setOpen(true)}>Open editor</button>
    {open ? <AnimatedModal label="Routine editor" onClose={() => setOpen(false)}>
      <button onClick={() => setOpen(false)}>Close editor</button>
      <input aria-label="Routine name" />
      <details><summary>More options</summary><input aria-label="Hidden option" /></details>
      <button disabled>Unavailable</button>
      <button>Save</button>
    </AnimatedModal> : null}
  </MotionPreferenceProvider>;
}

describe('Mobile modal accessibility', () => {
  it('traps focus, closes with Escape, and restores focus and scrolling', async () => {
    const user = userEvent.setup();
    const appRoot = document.createElement('div');
    appRoot.id = 'root';
    document.body.append(appRoot);
    const view = render(<Editor />, { container: appRoot });
    const trigger = screen.getByRole('button', { name: 'Open editor' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Routine editor' });
    expect(dialog).toHaveFocus();
    expect(appRoot).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close editor' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(appRoot).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
    view.unmount();
    appRoot.remove();
  });

  it('keeps content clicks inside and supports the close button and backdrop', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(screen.getByRole('button', { name: 'Open editor' }));
    await user.type(screen.getByLabelText('Routine name'), 'Push day');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open editor' }));
    fireEvent.click(screen.getByRole('dialog').parentElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('handles an empty panel and preserves pre-existing scroll/inert state', () => {
    const close = vi.fn();
    document.body.style.overflow = 'clip';
    const root = document.createElement('div');
    root.id = 'root';
    root.setAttribute('inert', '');
    document.body.append(root);
    const view = render(<MotionPreferenceProvider><AnimatedModal label="Loading" onClose={close}>Loading…</AnimatedModal></MotionPreferenceProvider>);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.body.style.overflow).toBe('clip');
    expect(root).toHaveAttribute('inert');
    root.remove();
    document.body.style.overflow = '';
  });
  it('keeps the background locked when exiting and entering dialogs overlap', () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    const dialogs = (first, second) => <MotionPreferenceProvider>
      {first ? <AnimatedModal key="first" label="Confirmation">Confirm</AnimatedModal> : null}
      {second ? <AnimatedModal key="second" label="Workout details">Saved</AnimatedModal> : null}
    </MotionPreferenceProvider>;
    const view = render(dialogs(true, false), { container: root });
    view.rerender(dialogs(true, true));
    expect(screen.getByRole('dialog', { name: 'Workout details' })).toHaveFocus();
    view.rerender(dialogs(false, true));
    expect(root).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('dialog', { name: 'Workout details' })).toHaveFocus();
    view.rerender(dialogs(false, false));
    expect(root).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
    view.unmount();
    root.remove();
  });

});
