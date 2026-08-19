import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import type { IncomeScenario } from '../../lib/engine';
import { inputCls, inputToPct, pctToInput } from '../../lib/utils';

export function ScenarioFormModal({
  scenario, onSave, onClose,
}: {
  scenario: IncomeScenario | null;
  onSave: (values: Omit<IncomeScenario, 'id' | 'createdAt' | 'isActive'> & { isActive?: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const { dividendTaxRates, ltTaxRate } = useData();
  const settings = { dividend: dividendTaxRates, lt: ltTaxRate };
  const [name, setName] = useState(scenario?.name ?? '');
  const [description, setDescription] = useState(scenario?.description ?? '');
  const [target, setTarget] = useState(scenario?.targetAnnualIncome != null ? String(scenario.targetAnnualIncome) : '');
  const [targetYear, setTargetYear] = useState(scenario?.targetYear != null ? String(scenario.targetYear) : '');
  const [qualified, setQualified] = useState(pctToInput(scenario?.qualifiedRate));
  const [ordinary, setOrdinary] = useState(pctToInput(scenario?.ordinaryRate));
  const [capGain, setCapGain] = useState(pctToInput(scenario?.capitalGainRate));

  const { busy, formError, submit } = useModalForm(async () => {
    if (!name.trim()) throw new Error('Name the scenario.');
    if (target !== '' && !(Number(target) > 0)) {
      throw new Error('Target income must be above zero — leave it blank for no target.');
    }
    const rates = [inputToPct(qualified), inputToPct(ordinary), inputToPct(capGain)];
    if (rates.some((r) => r != null && (Number.isNaN(r) || r < 0 || r >= 1))) {
      throw new Error('Rates are percentages between 0 and 99.');
    }
    await onSave({
      name: name.trim(),
      description: description || null,
      targetAnnualIncome: target === '' ? null : Number(target),
      targetYear: targetYear === '' ? null : Number(targetYear),
      qualifiedRate: rates[0],
      ordinaryRate: rates[1],
      capitalGainRate: rates[2],
    });
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title={scenario ? `Edit ${scenario.name}` : 'New scenario'}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input required value={name} onChange={(e) => setName(e.target.value)}
              className={inputCls} placeholder="Retire 2030" autoFocus />
          </Field>
          <Field label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Target income ($/yr, after-tax)">
            <input type="number" step="any" min="0" value={target}
              onChange={(e) => setTarget(e.target.value)} className={inputCls} placeholder="e.g. 40000" />
          </Field>
          <Field label="Retirement year">
            <input type="number" step="1" min="2026" max="2100" value={targetYear}
              onChange={(e) => setTargetYear(e.target.value)} className={inputCls} placeholder="e.g. 2030" />
          </Field>
        </div>
        <p className="text-xs font-medium text-gray-500 pt-1">
          Tax rates in this scenario — retired brackets usually differ from working ones. Blank uses
          the Tax Reserve settings.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Qualified (%)">
            <input type="number" step="any" min="0" max="99" value={qualified}
              onChange={(e) => setQualified(e.target.value)} className={inputCls}
              placeholder={`settings ${Math.round(settings.dividend.qualified * 100)}%`} />
          </Field>
          <Field label="Ordinary (%)">
            <input type="number" step="any" min="0" max="99" value={ordinary}
              onChange={(e) => setOrdinary(e.target.value)} className={inputCls}
              placeholder={`settings ${Math.round(settings.dividend.ordinary * 100)}%`} />
          </Field>
          <Field label="Capital gains LT (%)">
            <input type="number" step="any" min="0" max="99" value={capGain}
              onChange={(e) => setCapGain(e.target.value)} className={inputCls}
              placeholder={`settings ${Math.round(settings.lt * 100)}%`} />
          </Field>
        </div>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Save" onCancel={onClose} />
      </form>
    </Modal>
  );
}
