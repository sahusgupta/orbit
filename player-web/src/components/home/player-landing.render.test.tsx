import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PlayerLanding from './player-landing';

describe('landing initial content', () => {
  it('renders essential text and the primary action without an animation prerequisite', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<PlayerLanding />);
    const heading = host.querySelector('h1');
    const primaryAction = host.querySelector('.player-landing section a[href="/games"]');
    expect(heading?.textContent).toContain('Browse venue-published poker games.');
    expect(heading?.style.opacity).toBe('1');
    expect(primaryAction?.parentElement?.style.opacity).toBe('1');
  });
});
