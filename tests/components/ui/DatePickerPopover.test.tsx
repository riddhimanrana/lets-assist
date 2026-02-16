import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DatePicker } from '@/components/ui/date-picker';

// Note: We assert the calendar grid renders when opened.
// This guards against z-index/portal regressions where the picker opens but content is hidden/blocked.

describe('DatePicker popover', () => {
  it('renders calendar grid when trigger is clicked', async () => {
    const onChange = vi.fn();

    render(
      <div>
        <DatePicker value={undefined} onChange={onChange} data-testid="date-trigger" />
      </div>
    );

    fireEvent.click(screen.getByTestId('date-trigger'));

    // shadcn Calendar (react-day-picker) renders a grid.
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });
});
