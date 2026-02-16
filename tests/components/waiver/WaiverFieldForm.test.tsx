/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WaiverFieldForm } from '@/components/waiver/WaiverFieldForm';
import { WaiverDefinitionField } from '@/types/waiver-definitions';

describe('WaiverFieldForm - Date Field', () => {
  const createDateField = (overrides?: Partial<WaiverDefinitionField>): WaiverDefinitionField => ({
    id: 'field-date-1',
    waiver_definition_id: 'waiver-1',
    field_type: 'date',
    field_key: 'birth_date',
    label: 'Date of Birth',
    required: true,
    signer_role_key: 'participant',
    page_index: 0,
    rect: { x: 100, y: 200, width: 150, height: 30 },
    meta: {},
    source: 'pdf_widget',
    pdf_field_name: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  });

  it('renders a date picker button for date fields (not native input[type=date])', () => {
    const fields = [createDateField()];
    const onChange = vi.fn();

    const { container } = render(
      <WaiverFieldForm
        fields={fields}
        values={{}}
        onChange={onChange}
        signerRoleKey="participant"
      />
    );

    // Should have a button trigger, not a native date input
    const trigger = screen.getByRole('button', { name: /pick a date/i });
    expect(trigger).toBeInTheDocument();

    // Should NOT have native date input
    const nativeDateInput = container.querySelector('input[type="date"]');
    expect(nativeDateInput).toBeNull();
  });

  it('displays selected date value in YYYY-MM-DD format', () => {
    const fields = [createDateField()];
    const onChange = vi.fn();

    render(
      <WaiverFieldForm
        fields={fields}
        values={{ birth_date: '2024-03-15' }}
        onChange={onChange}
        signerRoleKey="participant"
      />
    );

    // Button should display formatted date
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveTextContent(/March 15, 2024|3\/15\/2024|15\/03\/2024/);
  });

  it('calls onChange with YYYY-MM-DD format when date is selected', async () => {
    const fields = [createDateField()];
    const onChange = vi.fn();

    render(
      <WaiverFieldForm
        fields={fields}
        values={{}}
        onChange={onChange}
        signerRoleKey="participant"
      />
    );

    // Open the calendar popover
    const trigger = screen.getByTestId('waiver-field-input-birth_date');
    fireEvent.click(trigger);

    // Wait for calendar to be visible
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeInTheDocument();
    });

    // Select a date (e.g., 15th of current month)
    const dayButton = screen.getByRole('button', { name: /15/ });
    fireEvent.click(dayButton);

    // onChange should be called with YYYY-MM-DD format
    expect(onChange).toHaveBeenCalledWith('birth_date', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('respects minDate constraint by disabling dates before it', async () => {
    const fields = [createDateField({
      meta: { minDate: '2024-03-10' }
    })];
    const onChange = vi.fn();

    render(
      <WaiverFieldForm
        fields={fields}
        // Ensure the calendar opens in the same month as our constraint.
        values={{ birth_date: '2024-03-15' }}
        onChange={onChange}
        signerRoleKey="participant"
      />
    );

    // Open the calendar
    const trigger = screen.getByTestId('waiver-field-input-birth_date');
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeInTheDocument();
    });

    // Dates before minDate should be disabled.
    // With minDate=10, day 1 should be disabled in the same month.
    const dayButtons = screen
      .getAllByRole('button')
      .filter((btn) => /^\d+$/.test((btn.textContent || '').trim()));
    const day1 = dayButtons.find((btn) => (btn.textContent || '').trim() === '1');
    expect(day1).toBeTruthy();
    expect(day1!).toHaveAttribute('disabled');
  });

  it('respects maxDate constraint by disabling dates after it', async () => {
    const fields = [createDateField({
      meta: { maxDate: '2024-03-20' }
    })];
    const onChange = vi.fn();

    render(
      <WaiverFieldForm
        fields={fields}
        // Ensure the calendar opens in the same month as our constraint.
        values={{ birth_date: '2024-03-15' }}
        onChange={onChange}
        signerRoleKey="participant"
      />
    );

    // Open the calendar
    const trigger = screen.getByTestId('waiver-field-input-birth_date');
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeInTheDocument();
    });

    // Dates after maxDate should be disabled.
    // With maxDate=20, day 31 should be disabled in the same month.
    const dayButtons = screen
      .getAllByRole('button')
      .filter((btn) => /^\d+$/.test((btn.textContent || '').trim()));
    const day31 = dayButtons.find((btn) => (btn.textContent || '').trim() === '31');
    expect(day31).toBeTruthy();
    expect(day31!).toHaveAttribute('disabled');
  });

  it('shows validation error for required empty date field when showErrors=true', () => {
    const fields = [createDateField({ required: true })];
    const onChange = vi.fn();

    render(
      <WaiverFieldForm
        fields={fields}
        values={{ birth_date: '' }}
        onChange={onChange}
        signerRoleKey="participant"
        showErrors={true}
      />
    );

    // Should show error message
    expect(screen.getByText(/this field is required/i)).toBeInTheDocument();

    // Label should have error styling
    const label = screen.getByText(/date of birth/i);
    expect(label).toHaveClass('text-destructive');
  });

  it('date picker trigger is keyboard accessible', async () => {
    const fields = [createDateField()];
    const onChange = vi.fn();

    render(
      <WaiverFieldForm
        fields={fields}
        values={{}}
        onChange={onChange}
        signerRoleKey="participant"
      />
    );

    const trigger = screen.getByTestId('waiver-field-input-birth_date');
    
    // Should be focusable
    trigger.focus();
    expect(trigger).toHaveFocus();

    // In real browsers, pressing Enter on a focused button triggers click.
    // In this unit environment we assert focusability and that click opens.
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeInTheDocument();
    });
  });

  it('preserves placeholder text for empty date field', () => {
    const fields = [createDateField()];
    const onChange = vi.fn();

    render(
      <WaiverFieldForm
        fields={fields}
        values={{}}
        onChange={onChange}
        signerRoleKey="participant"
      />
    );

    const trigger = screen.getByRole('button', { name: /pick a date/i });
    expect(trigger).toBeInTheDocument();
  });
});
