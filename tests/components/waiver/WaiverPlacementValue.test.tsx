import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { WaiverPlacementValue, type CustomPlacement } from '@/components/waiver/PdfViewerWithOverlay';

function placement(overrides: Partial<CustomPlacement> = {}): CustomPlacement {
  return {
    id: 'p1',
    fieldKey: 'full_name',
    label: 'Full Name',
    signerRoleKey: 'volunteer',
    fieldType: 'text',
    required: true,
    pageIndex: 0,
    rect: { x: 10, y: 10, width: 100, height: 20 },
    ...overrides,
  };
}

describe('WaiverPlacementValue', () => {
  it('renders text values for non-signature fields', () => {
    render(
      <WaiverPlacementValue
        placement={placement({ fieldType: 'text' })}
        fieldValue="Jane Doe"
      />
    );

    const el = screen.getByTestId('waiver-placement-text');
    expect(el).toHaveTextContent('Jane Doe');
    expect(el).toHaveClass('text-black/90');
  });

  it('renders a checkmark for checkbox true', () => {
    render(
      <WaiverPlacementValue
        placement={placement({ fieldType: 'checkbox' })}
        fieldValue={true}
      />
    );

    const el = screen.getByTestId('waiver-placement-checkbox');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('text-black/90');
  });

  it('renders nothing for checkbox false', () => {
    const { container } = render(
      <WaiverPlacementValue
        placement={placement({ fieldType: 'checkbox' })}
        fieldValue={false}
      />
    );

    expect(container.querySelector('[data-testid="waiver-placement-checkbox"]')).toBeNull();
  });

  it('renders typed signature text for signature placements', () => {
    render(
      <WaiverPlacementValue
        placement={placement({ fieldType: 'signature', label: 'Volunteer Signature' })}
        fieldValue={null}
        signature={{
          role_key: 'volunteer',
          method: 'typed',
          data: 'Jane Doe',
          timestamp: new Date().toISOString(),
        }}
      />
    );

    const el = screen.getByTestId('waiver-placement-signature-typed');
    expect(el).toHaveTextContent('Jane Doe');
    expect(el).toHaveClass('text-black/90');
  });

  it('renders signature image for draw signatures', () => {
    render(
      <WaiverPlacementValue
        placement={placement({ fieldType: 'signature', label: 'Volunteer Signature' })}
        fieldValue={null}
        signature={{
          role_key: 'volunteer',
          method: 'draw',
          data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg',
          timestamp: new Date().toISOString(),
        }}
      />
    );

    expect(screen.getByTestId('waiver-placement-signature-image')).toBeInTheDocument();
  });
});
