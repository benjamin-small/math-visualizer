import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Icon, { ICON_NAMES } from '../Icon.svelte';

describe('Icon', () => {
  it('renders every name as an aria-hidden outline svg', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(Icon, { props: { name } });
      const svg = container.querySelector('svg')!;
      expect(svg, name).toBeTruthy();
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.querySelector('path, circle, rect, polygon, line, polyline')).toBeTruthy();
      unmount();
    }
  });
});
