// src/components/ShipEditor/ShipEditor.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/packages/infra/supabase';
import {
  ShipArmor,
  ShipComponent,
  ShipCrew,
  ShipDeckRegion,
  ShipTemplate,
  ShipWeapon,
  WeaponArc,
} from '@/types/ship';
import {
  COMPONENT_NAMES,
  DEFAULT_CREW_STATS,
  DEFAULT_TOTAL_MASS,
  WEAPON_ARCS,
  addSlotToRegion,
  addWeaponArc,
  buildShipFromTemplate,
  canPlaceWeapon,
  canRemoveLastEmptySlot,
  componentById,
  componentByName,
  computeCrewHp,
  computeCrewWeeklyCost,
  computeHullCost,
  computeRemainingMass,
  computeShipBuild,
  createDefaultDeckLayout,
  deckDirection,
  effectiveWeaponArcs,
  isProtectedDefaultArc,
  removeLastEmptySlot,
  removeWeaponArc,
  resolveShipWeaponDamage,
  weaponById,
  weaponTons,
  mapCrewRows,
  mapOptionalComponentRows,
  mapShipArmorRow,
  mapShipComponentRow,
  mapShipTemplateRow,
  mapShipTemplateToRow,
  mapShipWeaponRow,
  mapWeaponRows,
} from '@/packages/ships';
import { ImagePickerModal } from '@/components/ImagePickerModal';
import { ShipLayout } from '@/components/ShipRenderer/ShipLayout';
import { ShipImagePreview } from '@/components/ShipRenderer/ShipImagePreview';
import { ShipComponentCardData } from '@/components/ShipRenderer/ShipComponentCard';
import { WeaponArcCompass } from '@/components/ShipRenderer/WeaponArcIcon';

type CrewDraft = {
  count: number;
  name: string;
  level: number;
  hp: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  cost: number;
};

function defaultCrewDraft(): CrewDraft {
  return {
    count: 1,
    name: '',
    level: 1,
    hp: computeCrewHp(1),
    ...DEFAULT_CREW_STATS,
    cost: computeCrewWeeklyCost(1),
  };
}

function humanize(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function Cell({ label, children, widthClass = 'w-16' }: { label: string; children: React.ReactNode; widthClass?: string }) {
  return (
    <label className={`flex flex-col gap-0.5 text-[10px] text-gray-400 min-w-0 ${widthClass}`}>
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, min, max, step, disabled }: {
  value: any; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={`ship-num-input w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    />
  );
}

/** A Stat-grid cell: small label over a bold value. */
function StatCell({ label, children, tone = 'default' }: { label: string; children: React.ReactNode; tone?: 'default' | 'warn' | 'red' }) {
  const color =
    tone === 'red' ? 'text-red-400' :
    tone === 'warn' ? 'text-amber-400' :
    'text-yellow-400';
  return (
    <div className="min-w-0">
      <label className="block text-[9px] text-gray-500 truncate">{label}</label>
      <div className={`text-sm font-bold truncate ${color}`}>{children}</div>
    </div>
  );
}

function Stepper({ value, onChange, min = 0, max = 9, label }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-6 h-6 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm leading-none"
      >
        −
      </button>
      <span className="w-5 text-center text-xs text-white">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-6 h-6 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm leading-none"
      >
        +
      </button>
      {label && <span className="text-[10px] text-gray-400 ml-1">{label}</span>}
    </div>
  );
}

// MC = hexes to travel per 60° turn — LOWER is better (tight turn), so the scale
// runs green (1-2) -> yellow (3-4) -> orange (5-7) -> red (8+).
function mcColor(mc: number) {
  if (mc <= 2) return 'bg-green-700 text-white';
  if (mc <= 4) return 'bg-yellow-700 text-white';
  if (mc <= 7) return 'bg-orange-700 text-white';
  return 'bg-red-700 text-white';
}

function crewStatLine(crew: ShipCrew): string {
  return `Level ${crew.level}, HP ${crew.hp}, ${crew.str}-${crew.dex}-${crew.con}-${crew.int}-${crew.wis}-${crew.cha}`;
}

function groupCrew(crews: ShipCrew[]) {
  const indexed = crews.map((crew, index) => ({ crew, index }));
  const named = indexed.filter(({ crew }) => !!crew.name);
  const unnamed = indexed.filter(({ crew }) => !crew.name);
  const unnamedCost = unnamed.reduce((sum, { crew }) => sum + crew.cost, 0);
  const first = unnamed[0]?.crew;
  const uniform = !!first && unnamed.every(({ crew }) =>
    crew.level === first.level && crew.hp === first.hp && crew.cost === first.cost &&
    crew.str === first.str && crew.dex === first.dex && crew.con === first.con &&
    crew.int === first.int && crew.wis === first.wis && crew.cha === first.cha
  );
  return { named, unnamed, unnamedCost, first, uniform };
}

export default function ShipEditor({ readOnly = false }: { readOnly?: boolean }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<ShipTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const savedSnapshotRef = useRef<string>('');
  const pendingActionRef = useRef<(() => void) | null>(null);

  const [armors, setArmors] = useState<ShipArmor[]>([]);
  const [components, setComponents] = useState<ShipComponent[]>([]);
  const [weaponsCatalog, setWeaponsCatalog] = useState<ShipWeapon[]>([]);

  const [formData, setFormData] = useState<ShipTemplate | null>(null);

  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneError, setCloneError] = useState('');

  // Performance box: formula text is hidden behind the [formulas] button.
  const [showFormula, setShowFormula] = useState(false);
  // Optional component catalog picker modal.
  const [showComponentsModal, setShowComponentsModal] = useState(false);
  // Ship image picker.
  const [showImagePicker, setShowImagePicker] = useState(false);
  // Right-click menu on a component/weapon card or an empty deck slot.
  const [cardMenu, setCardMenu] = useState<{
    data?: ShipComponentCardData;
    region?: ShipDeckRegion;
    index?: number;
    x: number;
    y: number;
  } | null>(null);
  // Crew roster modal.
  const [showCrewModal, setShowCrewModal] = useState(false);
  const [editingCrewIndex, setEditingCrewIndex] = useState<number | null>(null);
  const [crewDraft, setCrewDraft] = useState<CrewDraft>(defaultCrewDraft);
  const [crewDraftTouched, setCrewDraftTouched] = useState({ hp: false, cost: false });
  // Simulation-only cargo load; never changes the template's cargo allocation.
  const [simulatedCargo, setSimulatedCargo] = useState(0);

  const build = formData
    ? buildShipFromTemplate(formData, armors, components, weaponsCatalog)
    : null;
  const cargoCapacity = formData && build
    ? Math.max(0, Math.max(formData.cargoArea, Math.floor(computeRemainingMass(build) + formData.cargoArea)))
    : 0;
  const simulatedCargoClamped = Math.min(Math.max(0, simulatedCargo), cargoCapacity);
  const performanceMass = build
    ? Math.max(1, build.totalMass - cargoCapacity + simulatedCargoClamped)
    : 0;
  const stats = build ? computeShipBuild({ ...build, performanceMass }) : null;

  const isDirty = !!formData && JSON.stringify(formData) !== savedSnapshotRef.current;

  const requestAction = (action: () => void) => {
    if (isDirty) {
      pendingActionRef.current = action;
      setShowUnsavedModal(true);
    } else {
      action();
    }
  };

  const handleUnsavedSave = async () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setShowUnsavedModal(false);
    const ok = await handleSave();
    if (ok && action) action();
  };
  const handleUnsavedDiscard = () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setShowUnsavedModal(false);
    if (action) action();
  };
  const handleUnsavedCancel = () => {
    pendingActionRef.current = null;
    setShowUnsavedModal(false);
  };

  const updateFormData = useCallback((field: keyof ShipTemplate, value: any) => {
    if (readOnly) return;
    setFormData(prev => (prev ? { ...prev, [field]: value } : prev));
  }, [readOnly]);

  const dropCardKey = (key: string) => {
    if (!formData) return;
    updateFormData('reinforcements', formData.reinforcements.filter(k => k !== key && !k.startsWith(`${key}:`)));
  };

  const optionalComponentCount = (id: string): number =>
    formData?.optionalComponents.find(c => c.componentId === id)?.count || 0;

  const setOptionalComponentCount = (id: string, count: number) => {
    if (!formData) return;
    const existing = formData.optionalComponents.find(c => c.componentId === id);
    const next = count <= 0
      ? formData.optionalComponents.filter(c => c.componentId !== id)
      : existing
        ? formData.optionalComponents.map(c => (c.componentId === id ? { ...c, count } : c))
        : [...formData.optionalComponents, { componentId: id, count }];
    updateFormData('optionalComponents', next);
    if (count <= 0) dropCardKey(`optional:${id}`);
  };

  const setWeaponRow = (index: number, field: 'weaponId' | 'count', value: any) => {
    if (!formData) return;
    const weapons = formData.weapons.map((w, i) => (i === index ? { ...w, [field]: value } : w));
    if (weaponPlacedMass(weapons) > formData.weaponCapacity) {
      setError('That change would exceed the allocated weapon capacity.');
      return;
    }
    setError(null);
    updateFormData('weapons', weapons);
  };

  const addWeapon = () => {
    if (!formData || weaponsCatalog.length === 0) return;
    const capacity = stats?.weaponCapacity ?? 0;
    const placed = weaponPlacedMass(formData.weapons);
    const candidate = weaponsCatalog.find(w => canPlaceWeapon(placed, capacity, weaponTons(w)));
    if (!candidate) {
      setError('No weapon capacity left. Increase the Weapon capacity row first.');
      return;
    }
    setError(null);
    updateFormData('weapons', [...formData.weapons, {
      id: crypto.randomUUID(),
      weaponId: candidate.id,
      count: 1,
    }]);
  };

  const removeWeaponRow = (index: number) => {
    if (!formData) return;
    const removed = formData.weapons[index];
    updateFormData('weapons', formData.weapons.filter((_, i) => i !== index));
    if (removed) dropCardKey(`weapon:${removed.id}`);
  };

  const moveWeaponRow = (index: number, delta: -1 | 1) => {
    if (!formData) return;
    const target = index + delta;
    if (target < 0 || target >= formData.weapons.length) return;
    const weapons = [...formData.weapons];
    [weapons[index], weapons[target]] = [weapons[target], weapons[index]];
    updateFormData('weapons', weapons);
  };

  const handleSlotContextMenu = (
    event: React.MouseEvent,
    region: ShipDeckRegion,
    index: number,
    data?: ShipComponentCardData,
  ) => {
    if (readOnly) return;
    event.preventDefault();
    setCardMenu({ data, region, index, x: event.clientX, y: event.clientY });
  };

  const addSlot = () => {
    if (!formData || !build || !cardMenu?.region) return;
    setError(null);
    updateFormData('deckLayout', addSlotToRegion(build.deckLayout!, cardMenu.region));
    setCardMenu(null);
  };

  const removeSlot = () => {
    if (!formData || !build || !cardMenu?.region) return;
    if (!canRemoveLastEmptySlot(build.deckLayout!, cardMenu.region)) return;
    setError(null);
    updateFormData('deckLayout', removeLastEmptySlot(build.deckLayout!, cardMenu.region));
    setCardMenu(null);
  };

  const setFiringArc = (arc: WeaponArc, mode: 'add' | 'remove') => {
    if (!formData || !cardMenu?.region || !cardMenu.data?.cardKey) return;
    const key = cardMenu.data.cardKey;
    const next = mode === 'add'
      ? addWeaponArc(formData.weaponArcs[key], cardMenu.region, arc)
      : removeWeaponArc(formData.weaponArcs[key], cardMenu.region, arc);
    updateFormData('weaponArcs', { ...formData.weaponArcs, [key]: next });
  };

  const toggleReinforcement = (cardKey: string) => {
    if (!formData) return;
    const assigned = formData.reinforcements.includes(cardKey);
    if (assigned) {
      updateFormData('reinforcements', formData.reinforcements.filter(key => key !== cardKey));
      setCardMenu(null);
      return;
    }
    if (formData.reinforcements.length >= formData.reinforcement) {
      setError('No reinforcement modules left. Increase the Reinforcement row first.');
      setCardMenu(null);
      return;
    }
    setError(null);
    updateFormData('reinforcements', [...formData.reinforcements, cardKey]);
    setCardMenu(null);
  };

  const openAddCrew = () => {
    if (readOnly) return;
    setEditingCrewIndex(null);
    setCrewDraft(defaultCrewDraft());
    setCrewDraftTouched({ hp: false, cost: false });
    setShowCrewModal(true);
  };

  const openEditCrew = (index: number) => {
    if (readOnly) return;
    const c = formData?.crews[index];
    if (!c) return;
    setEditingCrewIndex(index);
    setCrewDraft({
      count: 1, name: c.name || '', level: c.level, hp: c.hp,
      str: c.str, dex: c.dex, con: c.con, int: c.int, wis: c.wis, cha: c.cha, cost: c.cost,
    });
    setCrewDraftTouched({ hp: true, cost: true });
    setShowCrewModal(true);
  };

  const confirmCrew = () => {
    if (!formData) return;
    const { count, name, level, hp, str, dex, con, int, wis, cha, cost } = crewDraft;
    const n = editingCrewIndex !== null ? 1 : Math.max(1, Math.floor(count) || 1);
    const rows: ShipCrew[] = Array.from({ length: n }, () => ({
      id: crypto.randomUUID(),
      name: name.trim() ? name.trim() : null,
      level, hp, str, dex, con, int, wis, cha, cost,
    }));
    if (editingCrewIndex !== null) {
      const crews = [...formData.crews];
      crews[editingCrewIndex] = rows[0];
      updateFormData('crews', crews);
    } else {
      updateFormData('crews', [...formData.crews, ...rows]);
    }
    setShowCrewModal(false);
    setEditingCrewIndex(null);
  };

  const removeCrew = (index: number) => {
    if (!formData) return;
    updateFormData('crews', formData.crews.filter((_, i) => i !== index));
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Flat queries + client-side join merge: avoids depending on PostgREST resolving
        // the ship_template_* relationships (a schema-cache hiccup would otherwise blank
        // the whole list).
        const [templatesRes, armorsRes, componentsRes, weaponsRes, templateComponentsRes, templateWeaponsRes, crewsRes] = await Promise.all([
          supabase.from('ship_templates').select('*').order('name'),
          supabase.from('ship_armors').select('*').order('id'),
          supabase.from('ship_components').select('*').order('id'),
          supabase.from('ship_weapons').select('*').order('id'),
          supabase.from('ship_template_components').select('*'),
          supabase.from('ship_template_weapons').select('*'),
          supabase.from('ship_crews').select('*'),
        ]);
        if (templatesRes.error) throw templatesRes.error;
        if (armorsRes.error) throw armorsRes.error;
        if (componentsRes.error) throw componentsRes.error;
        if (weaponsRes.error) throw weaponsRes.error;
        if (templateComponentsRes.error) throw templateComponentsRes.error;
        if (templateWeaponsRes.error) throw templateWeaponsRes.error;
        if (crewsRes.error) throw crewsRes.error;

        const componentsByTemplate = new Map<string, any[]>();
        for (const row of templateComponentsRes.data || []) {
          const list = componentsByTemplate.get(row.template_id) || [];
          list.push(row);
          componentsByTemplate.set(row.template_id, list);
        }
        const weaponsByTemplate = new Map<string, any[]>();
        for (const row of templateWeaponsRes.data || []) {
          const list = weaponsByTemplate.get(row.template_id) || [];
          list.push(row);
          weaponsByTemplate.set(row.template_id, list);
        }
        const crewsByTemplate = new Map<string, any[]>();
        for (const row of crewsRes.data || []) {
          const list = crewsByTemplate.get(row.template_id) || [];
          list.push(row);
          crewsByTemplate.set(row.template_id, list);
        }

        setTemplates((templatesRes.data || []).map(row => mapShipTemplateRow({
          ...row,
          ship_template_components: componentsByTemplate.get(row.id) || [],
          ship_template_weapons: weaponsByTemplate.get(row.id) || [],
          ship_crews: crewsByTemplate.get(row.id) || [],
        })));
        setArmors((armorsRes.data || []).map(mapShipArmorRow));
        setComponents((componentsRes.data || []).map(mapShipComponentRow));
        setWeaponsCatalog((weaponsRes.data || []).map(mapShipWeaponRow));
        setLoading(false);
      } catch (err: any) {
        console.error('Ship editor fetch error:', err);
        setError(err.message || 'Failed to load ship data');
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedId === 'new') return;
    if (selectedId) {
      const found = templates.find(t => t.id === selectedId);
      if (found) {
        setFormData({ ...found });
        savedSnapshotRef.current = JSON.stringify(found);
        setError(null);
        setSuccess(null);
      } else {
        setFormData(null);
      }
    } else {
      setFormData(null);
    }
  }, [selectedId, templates]);

  useEffect(() => {
    setSimulatedCargo(formData?.cargoArea ?? 0);
  }, [selectedId, formData?.id]);

  useEffect(() => {
    setSimulatedCargo(cargo => Math.min(cargo, cargoCapacity));
  }, [cargoCapacity]);

  // Warn when leaving the page with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const createBlankTemplate = (): ShipTemplate => {
    const firstArmor = armors.find(a => a.name === 'wood') || armors[0];
    return {
      id: crypto.randomUUID(),
      name: 'New Ship',
      role: '',
      armorId: firstArmor?.id || '',
      totalMass: DEFAULT_TOTAL_MASS,
      helm: 1,
      commandBridge: 0,
      sails: 0,
      rudders: 0,
      reinforcement: 0,
      crewQuarters: 0,
      weaponCapacity: 0,
      deckLayout: createDefaultDeckLayout(),
      reinforcements: [],
      weaponArcs: {},
      atmosphericSpeed: 0,
      damageThreshold: 15,
      imageUrl: '',
      keelLength: 100,
      imageOffsetY: 0,
      cargoArea: 0,
      optionalComponents: [],
      weapons: [],
      crews: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const handleNew = () => {
    if (readOnly) return;
    requestAction(() => {
      const blank = createBlankTemplate();
      setFormData(blank);
      savedSnapshotRef.current = JSON.stringify(blank);
      setSelectedId('new');
      setError(null);
      setSuccess(null);
    });
  };

  const handleClone = () => {
    if (readOnly) return;
    requestAction(() => {
      if (!formData) return;
      setCloneName(`${formData.name} (Clone)`);
      setCloneError('');
      setShowCloneModal(true);
    });
  };

  const withSyncedDeck = (template: ShipTemplate): ShipTemplate => ({
    ...template,
    deckLayout: build?.deckLayout ?? template.deckLayout,
    reinforcements: build?.reinforcements ?? template.reinforcements,
    weaponArcs: build?.weaponArcs ?? template.weaponArcs,
  });

  const fetchTemplateById = async (id: string): Promise<ShipTemplate> => {
    const { data } = await supabase
      .from('ship_templates')
      .select('*, ship_template_components(*), ship_template_weapons(*), ship_crews(*)')
      .eq('id', id)
      .single();
    if (!data) throw new Error('No data returned from save operation');
    return mapShipTemplateRow(data);
  };

  const replaceChildRows = async (ship: ShipTemplate) => {
    await supabase.from('ship_template_components').delete().eq('template_id', ship.id);
    const accRows = mapOptionalComponentRows(ship);
    if (accRows.length) {
      const { error } = await supabase.from('ship_template_components').insert(accRows);
      if (error) throw error;
    }
    await supabase.from('ship_template_weapons').delete().eq('template_id', ship.id);
    const wpnRows = mapWeaponRows(ship);
    if (wpnRows.length) {
      const { error } = await supabase.from('ship_template_weapons').insert(wpnRows);
      if (error) throw error;
    }
    await supabase.from('ship_crews').delete().eq('template_id', ship.id);
    const crewRows = mapCrewRows(ship);
    if (crewRows.length) {
      const { error } = await supabase.from('ship_crews').insert(crewRows);
      if (error) throw error;
    }
  };

  const adoptTemplate = (mapped: ShipTemplate) => {
    setTemplates(prev => {
      const idx = prev.findIndex(t => t.id === mapped.id);
      if (idx < 0) return [...prev, mapped];
      const copy = [...prev];
      copy[idx] = mapped;
      return copy;
    });
    setSelectedId(mapped.id);
    setFormData(mapped);
    savedSnapshotRef.current = JSON.stringify(mapped);
  };

  const flashSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  };

  const isNameTaken = (name: string, exceptId?: string) =>
    templates.some(t => t.name === name && t.id !== exceptId);

  const weaponPlacedMass = (rows: ShipTemplate['weapons']) =>
    rows.reduce((sum, row) => {
      const weapon = weaponById(weaponsCatalog, row.weaponId);
      return sum + (weapon ? weaponTons(weapon) * row.count : 0);
    }, 0);

  const confirmClone = async () => {
    if (!formData) return;
    if (!cloneName.trim()) {
      setCloneError('Name is required');
      return;
    }
    if (isNameTaken(cloneName.trim())) {
      setCloneError('A ship with this name already exists');
      return;
    }
    try {
      const newShip: ShipTemplate = withSyncedDeck({
        ...formData,
        id: crypto.randomUUID(),
        name: cloneName.trim(),
        optionalComponents: formData.optionalComponents.map(c => ({ ...c })),
        weapons: formData.weapons.map(w => ({ ...w })),
        crews: formData.crews.map(c => ({ ...c, id: crypto.randomUUID() })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const { data, error } = await supabase
        .from('ship_templates')
        .insert(mapShipTemplateToRow(newShip))
        .select('id')
        .single();
      if (error) throw error;
      await replaceChildRows(newShip);
      const mapped = await fetchTemplateById(data.id);
      adoptTemplate(mapped);
      setShowCloneModal(false);
      setCloneName('');
      flashSuccess(`Ship "${mapped.name}" cloned successfully!`);
    } catch (err: any) {
      setCloneError(err.message || 'Failed to clone ship');
    }
  };

  const handleSave = async (): Promise<boolean> => {
    if (readOnly) return false;
    if (!formData) {
      setError('No ship selected to save');
      return false;
    }
    if (!formData.name.trim()) {
      setError('Ship name is required');
      return false;
    }
    if (isNameTaken(formData.name.trim(), formData.id)) {
      setError('A ship with this name already exists');
      return false;
    }
    if (stats && formData.crews.length > stats.crewCapacity) {
      setError(`Crew roster (${formData.crews.length}) exceeds quarters capacity (${stats.crewCapacity}). Add crew quarters or remove crew before saving.`);
      return false;
    }

    try {
      const withDeck = withSyncedDeck(formData);
      const existsInDB = templates.some(t => t.id === formData.id);
      let id = formData.id;
      if (existsInDB) {
        const { error } = await supabase
          .from('ship_templates')
          .update(mapShipTemplateToRow(withDeck))
          .eq('id', formData.id)
          .select('id')
          .single();
        if (error) throw error;
      } else {
        const { id: _id, ...insertData } = mapShipTemplateToRow(withDeck);
        const { data, error } = await supabase
          .from('ship_templates')
          .insert(insertData)
          .select('id')
          .single();
        if (error) throw error;
        id = data.id;
      }

      const withId = { ...withDeck, id };
      await replaceChildRows(withId);
      const mapped = await fetchTemplateById(id);
      adoptTemplate(mapped);
      setError(null);
      flashSuccess(`Ship "${mapped.name}" saved successfully!`);
      return true;
    } catch (err: any) {
      console.error('Ship save error:', err);
      setError(err.message || 'Failed to save ship');
      return false;
    }
  };

  const handleDelete = async () => {
    if (readOnly) return;
    if (!formData) return;
    if (!confirm(`Delete ship "${formData.name}"?`)) return;
    try {
      const { error } = await supabase
        .from('ship_templates')
        .delete()
        .eq('id', formData.id);
      if (error) throw error;
      setTemplates(prev => prev.filter(t => t.id !== formData.id));
      setSelectedId(null);
      setFormData(null);
      savedSnapshotRef.current = '';
      flashSuccess('Ship deleted successfully!');
    } catch (err: any) {
      setError(err.message || 'Failed to delete ship');
    }
  };

  if (loading) {
    return (
      <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">
        Loading Archfar's Shipyard...
      </div>
    );
  }

  const selectedArmor = formData ? armors.find(a => a.id === formData.armorId) : null;
  const massOverload = stats?.overload ?? false;
  const weaponPlaced = stats?.weaponPlacedTons ?? 0;
  const weaponCapacity = stats?.weaponCapacity ?? 0;
  const weaponOverCapacity = weaponPlaced > weaponCapacity;
  const canAddWeapon = !!formData && weaponsCatalog.some(w => canPlaceWeapon(weaponPlaced, weaponCapacity, weaponTons(w)));
  const weaponOptions = [...weaponsCatalog].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const crewOverCapacity = !!formData && !!stats && formData.crews.length > stats.crewCapacity;
  const isNew = !!formData && !templates.some(t => t.id === formData.id);
  const mcLabel = (v: number) => (Number.isFinite(v) ? `${v}` : '—');
  const armorName = (id: string) => {
    const armor = armors.find(a => a.id === id);
    return armor ? humanize(armor.name) : '—';
  };
  const weaponCapacityComponent = formData
    ? componentByName(components, COMPONENT_NAMES.weaponCapacity)
    : null;
  const rowCost = (name: string, count: number) =>
    formData ? componentByName(components, name).cost * count : 0;
  const hullCost = computeHullCost(formData?.totalMass ?? 0);
  const helmCost = rowCost(COMPONENT_NAMES.helm, Math.max(0, (formData?.helm ?? 0) - 1));
  const bridgeCost = rowCost(COMPONENT_NAMES.commandBridge, formData?.commandBridge ?? 0);
  const sailCost = rowCost(COMPONENT_NAMES.sail, formData?.sails ?? 0);
  const rudderCost = rowCost(COMPONENT_NAMES.rudder, formData?.rudders ?? 0);
  const capacityCost = formData
    ? formData.weaponCapacity * (weaponCapacityComponent?.cost ?? 0)
    : 0;
  const reinforcementCost = rowCost(COMPONENT_NAMES.reinforcement, formData?.reinforcement ?? 0);
  const quartersCost = rowCost(COMPONENT_NAMES.crewQuarters, formData?.crewQuarters ?? 0);
  const cargoCost = rowCost(COMPONENT_NAMES.cargo, formData?.cargoArea ?? 0);


  return (
    <div className="flex flex-col h-screen bg-[#0d0d1a] text-white">
      <div className="relative flex items-center justify-between px-6 py-3 border-b border-gray-700 bg-[#0d0d1a]">
        <h1 className="shrink-0 text-2xl font-bold text-white">Archfar's Shipyard</h1>
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 w-[min(44rem,46vw)] -translate-x-1/2 -translate-y-1/2"
          aria-live="polite"
        >
          <div className="pointer-events-auto max-h-16 space-y-1 overflow-y-auto">
            {error && (
              <div
                role="alert"
                className="rounded border border-red-500 bg-red-900/95 px-3 py-1.5 text-[11px] text-white shadow-xl backdrop-blur"
              >
                <div className="flex items-start gap-2">
                  <span className="flex-1">{error}</span>
                  <button
                    type="button"
                    className="shrink-0 text-red-200 hover:text-white"
                    onClick={() => setError(null)}
                    aria-label="Dismiss error"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
            {success && (
              <div
                role="status"
                className="rounded border border-green-500 bg-green-900/95 px-3 py-1.5 text-[11px] text-white shadow-xl backdrop-blur"
              >
                {success}
              </div>
            )}
            {massOverload && (
              <div className="rounded border border-red-500 bg-red-900/90 px-3 py-1.5 text-[11px] text-red-100">
                Over the designated mass by {Math.abs(stats?.remainingMass ?? 0)}t — remove fittings or raise total mass.
              </div>
            )}
            {formData && stats && formData.crews.length < stats.minCrew && (
              <div className="rounded border border-amber-500 bg-amber-900/90 px-3 py-1.5 text-[11px] text-amber-100">
                Below minimum crew ({stats.minCrew}) — the ship cannot operate all stations.
              </div>
            )}
            {crewOverCapacity && (
              <div className="rounded border border-red-500 bg-red-900/90 px-3 py-1.5 text-[11px] text-red-100">
                Crew roster ({formData?.crews.length ?? 0}) exceeds quarters capacity ({stats?.crewCapacity ?? 0}).
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {readOnly && (
            <span className="px-3 py-1 rounded bg-gray-700 border border-gray-600 text-xs text-gray-300">
              Read-only view — building requires an admin
            </span>
          )}
          <button
            onClick={() => requestAction(() => router.push('/'))}
            className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
          >
            Main Menu
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left — template picker */}
        <div className="w-1/4 max-w-[256px] flex-shrink-0 p-4 border-r border-gray-700 flex flex-col bg-[#0d0d1a]">
          <div className="flex gap-2 mb-4">
            {!readOnly && (
              <>
                <button
                  onClick={handleNew}
                  className="flex-1 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                >
                  New
                </button>
              </>
            )}
          </div>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search ships..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {templates
              .filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()))
              .map(template => {
                const isSelected = template.id === selectedId;
                return (
                  <div
                    key={template.id}
                    onClick={() => requestAction(() => setSelectedId(template.id))}
                    className={`px-3 py-2 rounded cursor-pointer transition border ${
                      isSelected
                        ? 'bg-yellow-500/20 border-yellow-400'
                        : 'bg-gray-700 border-gray-600 hover:bg-gray-600'
                    }`}
                  >
                    <div className="font-medium truncate">{template.name}</div>
                    {template.role?.trim() && (
                      <div className="text-sm text-gray-300 truncate">{template.role}</div>
                    )}
                    <div className="text-xs text-gray-500">
                      {template.totalMass}t · {armorName(template.armorId)}
                    </div>
                  </div>
                );
              })}
            {templates.length === 0 && (
              <div className="text-sm text-gray-500 text-center py-4">
                No ships found. Create one with "New".
              </div>
            )}
          </div>
        </div>

                {/* Middle — builder */}
        <div className="flex-1 min-w-0 flex flex-col bg-[#0d0d1a]">
          {formData ? (
            <>
              <div className="flex-1 overflow-y-auto p-6">
                <fieldset disabled={readOnly} className="max-w-4xl space-y-4">
                  {/* Identity + mass */}
                  <div className="flex items-end gap-2">
                    <Cell label="Ship Name" widthClass="flex-1">
                      <input
                        type="text"
                        value={formData.name || ''}
                        onChange={(e) => updateFormData('name', e.target.value)}
                        className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                      />
                    </Cell>
                    <Cell label="Role" widthClass="flex-1">
                      <input
                        type="text"
                        value={formData.role || ''}
                        placeholder="e.g. Shuttle, Scout, Heavy Melee"
                        onChange={(e) => updateFormData('role', e.target.value)}
                        className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                      />
                    </Cell>
                    <Cell label="Total mass (ton)" widthClass="w-32">
                      <NumInput
                        value={formData.totalMass}
                        min={1}
                        max={500}
                        onChange={(v) => updateFormData('totalMass', Math.max(1, Math.floor(v)))}
                      />
                    </Cell>
                  </div>

                  {/* Authored parameters */}
                  <div className="flex items-end gap-2">
                    <Cell label="Atmospheric speed (0–12)" widthClass="w-44">
                      <NumInput
                        value={formData.atmosphericSpeed}
                        min={0}
                        max={12}
                        onChange={(v) => updateFormData('atmosphericSpeed', Math.max(0, Math.min(12, Math.floor(v))))}
                      />
                    </Cell>
                    <Cell label="Damage threshold" widthClass="w-32">
                      <NumInput
                        value={formData.damageThreshold}
                        min={0}
                        max={999}
                        onChange={(v) => updateFormData('damageThreshold', Math.max(0, Math.floor(v)))}
                      />
                    </Cell>
                  </div>

                  {/* Summary */}
                  {stats && build && (
                    <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                      <div className="grid grid-cols-4 gap-2">
                        <StatCell label="Ship Mass">{stats.totalMass}t</StatCell>
                        <StatCell label="Armor">
                          {armorName(formData.armorId)} · AC {stats.ac}
                        </StatCell>
                        <StatCell label="HP">{stats.shipHp}</StatCell>
                        <StatCell label="Damage threshold">{stats.damageThreshold}</StatCell>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mt-2">
                        <StatCell label="Cargo">{simulatedCargoClamped} / {cargoCapacity}t</StatCell>
                        <StatCell label="Crew (min / full)">{stats.minCrew} / {stats.fullCrew}</StatCell>
                        <StatCell label="Ship cost">{stats.buildCost.toLocaleString()}gp</StatCell>
                        <StatCell label="Weekly operation">{stats.weeklyOperationCost.toLocaleString()}gp</StatCell>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        <StatCell label="Atmospheric speed">{stats.atmosphericSpeed}</StatCell>
                        <StatCell label="Space Acceleration">{stats.accel}</StatCell>
                        <StatCell label="Maneuver class (MC)">{mcLabel(stats.mcRaw)}</StatCell>
                      </div>

                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[9px] text-gray-500">
                          <span>Cargo simulation</span>
                          <span>{simulatedCargoClamped} / {cargoCapacity}t</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0, cargoCapacity)}
                          step={1}
                          value={simulatedCargoClamped}
                          disabled={readOnly || cargoCapacity <= 0}
                          onChange={(e) => setSimulatedCargo(Math.max(0, Math.min(cargoCapacity, Number(e.target.value) || 0)))}
                          className="w-full accent-yellow-400 disabled:opacity-50"
                          aria-label="Cargo simulation"
                        />
                      </div>

                      <div className="mt-2 pt-2 border-t border-gray-700 flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] text-gray-500">MC</span>
                        {stats.mcBands.map(band => (
                          <span key={band.label} className="text-[9px] text-gray-400">
                            {band.label}:{' '}
                            <span className={`px-1 rounded ${Number.isFinite(band.mc) ? mcColor(band.mc) : 'bg-gray-700 text-gray-400'}`}>
                              {mcLabel(band.mc)}
                            </span>
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => setShowFormula(v => !v)}
                          className="ml-auto px-2 py-0.5 text-[10px] bg-gray-700 border border-gray-600 text-gray-300 rounded hover:bg-gray-600"
                        >
                          {showFormula ? 'hide formulas' : 'formulas'}
                        </button>
                      </div>

                      {showFormula && (
                        <div className="text-[9px] font-mono text-gray-500 mt-2 leading-relaxed overflow-x-auto">
                          <div>Hull mass = totalMass × (10% + totalMass / 500) = {stats.totalMass} × (0.10 + {stats.totalMass}/500) = {stats.hullMassExact.toFixed(2)}t → {stats.hullMass}t</div>
                          <div>Armor mass = totalMass × armor% = {stats.totalMass} × {(selectedArmor?.massPct ?? 0) * 100}% = {stats.armorMassExact.toFixed(2)}t → {stats.armorMass}t</div>
                          <div>Weapon capacity counts toward ship mass; placed weapons must fit inside it.</div>
                          <div>Performance mass = totalMass − maxCargo + simulatedCargo = {stats.totalMass} − {cargoCapacity} + {simulatedCargoClamped} = {stats.performanceMass}t</div>
                          <div>Acceleration = (sails + rudders) / performanceMass × 15 = ({formData.sails} + {formData.rudders}) / {stats.performanceMass} × 15 = {stats.accel}</div>
                          <div>MC: x = rudders × 10 / performanceMass = {formData.rudders} × 10 / {stats.performanceMass} = {((formData.rudders * 10) / Math.max(1, stats.performanceMass)).toFixed(3)} → {mcLabel(stats.mcRaw)}</div>
                          <div>effectiveMC = MC − 1 (speed 0–2) · MC (3–7) · MC + 1 (8–12), floored at 0</div>
                          <div>HP = (totalMass × 3 + 40) × armor HP multiplier = ({stats.totalMass} × 3 + 40) × {selectedArmor?.hpMult ?? 1} = {stats.shipHp}</div>
                          <div>Weekly operation = 0.4% × ship cost + roster weekly cost = {stats.buildCost.toLocaleString()} × 0.004 + {stats.crewWeeklyCost.toLocaleString()} = {stats.weeklyOperationCost.toLocaleString()}gp</div>
                          <div>Atmospheric speed and damage threshold are authored values.</div>
                        </div>
                      )}

                    </div>
                  )}

                  {/* Composition */}
                  <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] text-gray-400">Ship configuration</label>
                      <button
                        type="button"
                        onClick={() => setShowComponentsModal(true)}
                        className="px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition"
                      >
                        + Add component
                      </button>
                    </div>

                                        <table className="w-full table-auto text-[11px]">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-700">
                          <th className="text-left py-1 pr-2 font-normal">Component</th>
                          <th className="text-center py-1 px-2 font-normal">Input</th>
                          <th className="text-right py-1 px-2 font-normal">Mass (ton)</th>
                          <th className="text-right py-1 px-2 font-normal">Crew req.</th>
                          <th className="text-left py-1 pl-2 font-normal">Notes</th>
                          <th className="text-right py-1 pl-2 font-normal">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Hull</td>
                          <td className="text-center px-2 text-gray-500">—</td>
                          <td className="text-right px-2">{stats?.massBreakdown.hull ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">Ship frame and structure</td>
                          <td className="text-right pl-2 text-yellow-400">{hullCost.toLocaleString()}gp</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Deck</td>
                          <td className="text-center px-2 text-gray-500">—</td>
                          <td className="text-right px-2">{stats?.massBreakdown.deck ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">20% of hull (min 1) · hittable</td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Helm</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-full max-w-16">
                              <NumInput value={formData.helm} min={0} max={9} onChange={(v) => updateFormData('helm', Math.max(0, Math.floor(v)))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.helm ?? 0}</td>
                          <td className="text-right px-2">{Math.ceil(formData.helm * 1)}</td>
                          <td className="pl-2 text-gray-500">1t each · 1 crew · first helm included in hull price</td>
                          <td className="text-right pl-2 text-yellow-400">{helmCost.toLocaleString()}gp</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Command bridge</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-full max-w-16">
                              <NumInput value={formData.commandBridge} min={0} max={2} onChange={(v) => updateFormData('commandBridge', Math.max(0, Math.min(2, Math.floor(v))))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.commandBridge ?? 0}</td>
                          <td className="text-right px-2">{Math.ceil(formData.commandBridge * 5)}</td>
                          <td className="pl-2 text-gray-500">3t each · 5 crew · +5 command</td>
                          <td className="text-right pl-2 text-yellow-400">{bridgeCost.toLocaleString()}gp</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Sail</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-full max-w-16">
                              <NumInput value={formData.sails} min={0} max={99} onChange={(v) => updateFormData('sails', Math.max(0, Math.floor(v)))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.sails ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">1t each · no crew</td>
                          <td className="text-right pl-2 text-yellow-400">{sailCost.toLocaleString()}gp</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Rudder vane</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-full max-w-16">
                              <NumInput value={formData.rudders} min={0} max={99} onChange={(v) => updateFormData('rudders', Math.max(0, Math.floor(v)))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.rudders ?? 0}</td>
                          <td className="text-right px-2">{Math.ceil(formData.rudders * 0.5)}</td>
                          <td className="pl-2 text-gray-500">1.5t each (rounded) · ½ crew</td>
                          <td className="text-right pl-2 text-yellow-400">{rudderCost.toLocaleString()}gp</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Weapon capacity</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-full max-w-16">
                              <NumInput
                                value={formData.weaponCapacity}
                                min={Math.ceil(weaponPlaced)}
                                max={999}
                                onChange={(v) => {
                                  const next = Math.max(0, Math.floor(v));
                                  if (next < Math.ceil(weaponPlaced)) {
                                    setError('Weapon capacity cannot be below the mass of placed weapons.');
                                    return;
                                  }
                                  setError(null);
                                  updateFormData('weaponCapacity', next);
                                }}
                              />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.weaponCapacity ?? 0}</td>
                          <td className="text-right px-2 text-gray-500">—</td>
                          <td className={`pl-2 ${weaponOverCapacity ? 'text-red-400' : 'text-gray-500'}`}>
                            {weaponCapacityComponent?.effect ? `${weaponCapacityComponent.effect} · ` : ''}
                            Placed {stats?.weaponPlacedTons ?? 0}t / {stats?.weaponCapacity ?? 0}t · handling crew excluded from min crew
                          </td>
                          <td className="text-right pl-2 text-yellow-400">{capacityCost.toLocaleString()}gp</td>
                        </tr>

                        {/* Weapon child list */}
                        <tr className="border-b border-gray-700/50">
                          <td colSpan={6} className="pb-2">
                            <div className="w-full min-w-0 rounded border border-gray-700 bg-gray-900/40 p-2">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-[10px] text-gray-400">Weapons (placed / capacity)</span>
                                <button
                                  type="button"
                                  onClick={addWeapon}
                                  disabled={readOnly || !canAddWeapon}
                                  className="px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  + Add weapon
                                </button>
                              </div>
                              {formData.weapons.length === 0 ? (
                                <div className="text-[11px] text-gray-400 border border-gray-700 rounded p-2 text-center">
                                  No weapons mounted.
                                </div>
                              ) : (
                                <div className="space-y-1 min-w-0">
                                  {formData.weapons.map((w, idx) => {
                                    const wpn = weaponById(weaponsCatalog, w.weaponId);
                                    const directions = Array.from({ length: w.count }, (_, i) =>
                                      build ? deckDirection(build.deckLayout!, `weapon:${w.id}:${i}`) : '—',
                                    ).filter(d => d !== '—');
                                    const direction = Array.from(new Set(directions)).join(' / ') || '—';
                                    return (
                                      <div
                                        key={w.id}
                                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_3.5rem_5rem_5rem_1.75rem_2rem] items-center gap-1"
                                      >
                                        <select
                                          value={w.weaponId}
                                          onChange={(e) => setWeaponRow(idx, 'weaponId', e.target.value)}
                                          className="w-full min-w-0 bg-gray-700 text-white text-[10px] rounded px-1.5 py-1 border border-gray-600"
                                        >
                                          {weaponOptions.map(weap => (
                                            <option key={weap.id} value={weap.id}>
                                              {weap.name} — {resolveShipWeaponDamage(weap, formData.totalMass)} ({weap.mass}t, crew {weap.crew}, reload {weap.reloadSteps} step{weap.reloadSteps === 1 ? '' : 's'})
                                            </option>
                                          ))}
                                        </select>
                                        <div className="min-w-0">
                                          <NumInput
                                            value={w.count}
                                            min={1}
                                            max={99}
                                            onChange={(v) => setWeaponRow(idx, 'count', Math.max(1, Math.floor(v)))}
                                          />
                                        </div>
                                        <span
                                          className="min-w-0 truncate text-center text-[9px] text-gray-300 bg-gray-900/70 border border-gray-600 rounded px-1 py-0.5"
                                          title={direction}
                                        >
                                          {direction}
                                        </span>
                                        <span className="min-w-0 text-right text-[9px] text-yellow-400 whitespace-nowrap">
                                          {((wpn?.cost || 0) * w.count).toLocaleString()}gp
                                        </span>
                                        <div className="flex flex-col items-center gap-0.5">
                                          <button
                                            type="button"
                                            onClick={() => moveWeaponRow(idx, -1)}
                                            disabled={idx === 0}
                                            title="Move weapon up"
                                            className="px-1 text-[7px] leading-none bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                          >
                                            ▲
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => moveWeaponRow(idx, 1)}
                                            disabled={idx === formData.weapons.length - 1}
                                            title="Move weapon down"
                                            className="px-1 text-[7px] leading-none bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                          >
                                            ▼
                                          </button>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => removeWeaponRow(idx)}
                                          className="text-[10px] bg-red-700 hover:bg-red-600 px-1.5 py-0.5 rounded text-white flex-none"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {weaponOverCapacity && (
                                <p className="text-[10px] text-red-400 mt-1">
                                  Placed weapons exceed the allocated capacity.
                                </p>
                              )}
                              <p className="text-[9px] text-gray-500 mt-1">
                                Weapon crew: {stats?.weaponCrew ?? 0} (not counted toward min crew).
                              </p>
                            </div>
                          </td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Armor</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-full max-w-20">
                              <select
                                value={formData.armorId || ''}
                                onChange={(e) => updateFormData('armorId', e.target.value)}
                                className="w-full bg-gray-700 text-white text-[10px] rounded px-1 py-0.5 border border-gray-600"
                              >
                                {armors.map(armor => (
                                  <option key={armor.id} value={armor.id}>
                                    {humanize(armor.name)} (AC {armor.ac})
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.armor ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">
                            {Math.round((selectedArmor?.massPct ?? 0) * 100)}% mass · AC {selectedArmor?.ac ?? '—'} · HP ×{selectedArmor?.hpMult ?? 1}
                          </td>
                          <td className="text-right pl-2 text-yellow-400">0gp</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Reinforcement</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-full max-w-16">
                              <NumInput
                                value={formData.reinforcement}
                                min={0}
                                max={99}
                                onChange={(v) => {
                                  const next = Math.max(0, Math.floor(v));
                                  updateFormData('reinforcement', next);
                                  updateFormData('reinforcements', formData.reinforcements.slice(0, next));
                                }}
                              />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.reinforcement ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">1t each · +10 temp HP (target later)</td>
                          <td className="text-right pl-2 text-yellow-400">{reinforcementCost.toLocaleString()}gp</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Crew quarter</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-full max-w-16">
                              <NumInput value={formData.crewQuarters} min={0} max={99} onChange={(v) => updateFormData('crewQuarters', Math.max(0, Math.floor(v)))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.crewQuarters ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">1t each · {stats?.crewCapacity ?? 0} capacity</td>
                          <td className="text-right pl-2 text-yellow-400">{quartersCost.toLocaleString()}gp</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Cargo</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-full max-w-16">
                              <NumInput
                                value={formData.cargoArea}
                                min={0}
                                max={Math.max(0, cargoCapacity)}
                                onChange={(v) => updateFormData('cargoArea', Math.max(0, Math.min(Math.floor(v), cargoCapacity)))}
                              />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.cargo ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">Max {cargoCapacity}t</td>
                          <td className="text-right pl-2 text-yellow-400">{cargoCost.toLocaleString()}gp</td>
                        </tr>

                        {formData.optionalComponents.map((a) => {
                          const component = componentById(components, a.componentId);
                          if (!component.id) return null;
                          return (
                            <tr key={a.componentId} className="border-b border-gray-700/50">
                              <td className="py-1 pr-2">
                                <span className="break-words">{component.name}</span>
                              </td>
                              <td className="text-center px-2">
                                <div className="mx-auto w-fit">
                                  <Stepper value={a.count} onChange={(v) => setOptionalComponentCount(component.id, v)} max={3} />
                                </div>
                              </td>
                              <td className="text-right px-2">{Math.round((component.mass || 0) * a.count)}</td>
                              <td className="text-right px-2">{Math.ceil((component.crew || 0) * a.count)}</td>
                              <td className="pl-2 text-gray-500">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="break-words">{component.effect || `${component.mass}t each`}</span>
                                  <button
                                    type="button"
                                    onClick={() => setOptionalComponentCount(component.id, 0)}
                                    className="text-[10px] bg-red-700 hover:bg-red-600 px-1.5 py-0.5 rounded text-white flex-none"
                                  >
                                    ×
                                  </button>
                                </div>
                              </td>
                              <td className="text-right pl-2 text-yellow-400">{((component.cost || 0) * a.count).toLocaleString()}gp</td>
                            </tr>
                          );
                        })}

                        <tr className="border-t border-gray-600 text-gray-300">
                          <td className="py-1.5 pr-2 font-semibold">Total</td>
                          <td className="text-center px-2 text-gray-500">—</td>
                          <td className="text-right px-2 font-semibold">{stats?.usedMass ?? 0} / {stats?.totalMass ?? 0}t</td>
                          <td className="text-right px-2 font-semibold">{stats?.minCrew ?? 0}</td>
                          <td className="pl-2 text-gray-500">Remaining {stats?.remainingMass ?? 0}t</td>
                          <td className="text-right pl-2 font-semibold text-gray-300">{stats?.buildCost.toLocaleString() ?? 0}gp</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </fieldset>
              </div>

              {/* Sticky Save bar */}
              {!readOnly && (
                <div className="flex-none px-6 py-3 border-t border-gray-700 bg-[#0d0d1a] flex gap-3">
                  <button
                    onClick={handleSave}
                    disabled={crewOverCapacity}
                    className="px-6 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isNew ? 'Create' : 'Save'}
                  </button>
                  {crewOverCapacity && (
                    <span className="self-center text-[10px] text-red-400">
                      Crew roster exceeds quarters capacity.
                    </span>
                  )}
                  <button
                    onClick={handleClone}
                    disabled={!formData}
                    className="px-6 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Clone
                  </button>
                  {!isNew && (
                    <button
                      onClick={handleDelete}
                      className="px-6 py-2 bg-red-800 border-2 border-red-400 text-white rounded hover:bg-red-700 transition"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center flex-1 text-gray-500">
              Select a ship from the list or create a new one
            </div>
          )}
        </div>

        {/* Right — ship image, layout, weapons, roster */}
        <div className="flex-[0_0_34%] min-w-[320px] max-w-[44%] p-4 border-l border-gray-700 bg-[#0d0d1a] overflow-y-auto">
          {formData && build && stats ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => setShowImagePicker(true)}
                      className="w-full px-2 py-1 text-[10px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700"
                    >
                      {formData.imageUrl ? 'Change image' : 'Upload image'}
                    </button>
                  ) : (
                    <div className="text-[10px] text-gray-400">Ship image</div>
                  )}
                  <Cell label="Keel length (ft)" widthClass="w-full">
                    <NumInput
                      value={formData.keelLength}
                      min={1}
                      max={2000}
                      disabled={readOnly}
                      onChange={(v) => updateFormData('keelLength', Math.max(1, Math.floor(v)))}
                    />
                  </Cell>
                  <Cell label="Vertical offset (ft)" widthClass="w-full">
                    <NumInput
                      value={formData.imageOffsetY}
                      min={-2000}
                      max={2000}
                      disabled={readOnly}
                      onChange={(v) => updateFormData('imageOffsetY', Math.round(v))}
                    />
                  </Cell>
                </div>
                <div className="shrink-0">
                  <ShipImagePreview
                    imageUrl={formData.imageUrl}
                    keelLength={formData.keelLength}
                    imageOffsetY={formData.imageOffsetY}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Ship layout</label>
                <ShipLayout
                  build={build}
                  stats={stats}
                  readOnly={readOnly}
                  onDeckChange={(layout) => updateFormData('deckLayout', layout)}
                  onSlotContextMenu={readOnly ? undefined : handleSlotContextMenu}
                />
              </div>

              <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <label className={`block text-[10px] ${crewOverCapacity ? 'text-red-400' : 'text-gray-400'}`}>
                    Ship roster ({formData.crews.length}) · Min {stats.minCrew} / Full {stats.fullCrew} · Quarters {stats.crewCapacity}
                  </label>
                  <button
                    type="button"
                    onClick={openAddCrew}
                    disabled={readOnly}
                    className="px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    + Add crew
                  </button>
                </div>

                {crewOverCapacity && (
                  <p className="text-[10px] text-red-400 mb-1">
                    Roster exceeds crew capacity by {formData.crews.length - stats.crewCapacity}. Saving is blocked.
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mb-2" title="Crew roster">
                  {Array.from({ length: Math.min(formData.crews.length, 80) }).map((_, i) => (
                    <span key={i} className="w-2.5 h-2.5 rounded-full border border-gray-400" />
                  ))}
                  {formData.crews.length > 80 && (
                    <span className="text-[9px] text-gray-500">+{formData.crews.length - 80}</span>
                  )}
                </div>

                {formData.crews.length === 0 ? (
                  <div className="text-[11px] text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-2 text-center">
                    No crew assigned. Add named or unnamed crew.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {(() => {
                      const { named, unnamed, unnamedCost, first, uniform } = groupCrew(formData.crews);
                      return (
                        <>
                          {named.map(({ crew, index }) => (
                            <div key={crew.id} className="flex items-center justify-between gap-2 bg-gray-800 rounded px-2 py-1">
                              <div className="min-w-0 text-[11px] text-gray-200">
                                {crew.name}
                                <span className="text-gray-500">
                                  {' '}— {crewStatLine(crew)},{' '}
                                </span>
                                <span className="text-green-400">{crew.cost} Gp</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditCrew(index)}
                                  className="text-[10px] bg-blue-700 hover:bg-blue-600 px-1.5 py-0.5 rounded text-white"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeCrew(index)}
                                  className="text-[10px] bg-red-700 hover:bg-red-600 px-1.5 py-0.5 rounded text-white"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          ))}
                          {unnamed.length > 0 && first && (
                            <div className="flex items-center justify-between gap-2 bg-gray-800/60 border border-dashed border-gray-600 rounded px-2 py-1">
                              <div className="min-w-0 text-[11px] text-gray-300">
                                Unnamed crew × {unnamed.length}
                                {uniform ? (
                                  <span className="text-gray-500"> — {crewStatLine(first)}, </span>
                                ) : (
                                  <span className="text-gray-500"> — mixed stats, </span>
                                )}
                                <span className="text-green-400">{uniform ? `${first.cost} Gp each` : `${unnamedCost} Gp total`}</span>
                              </div>
                              {uniform && (
                                <span className="text-[10px] text-gray-400 whitespace-nowrap">{unnamedCost} Gp</span>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-center">
              Select a ship<br />to see details
            </div>
          )}
        </div>
      </div>

{/* Clone / Save As modal */}
      {showCloneModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 border border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-white">
              {formData && templates.some(t => t.id === formData.id) ? 'Clone Ship' : 'Save As'}
            </h2>
            <div>
              <label className="block text-sm text-gray-300 mb-1">New Ship Name</label>
              <input
                type="text"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                placeholder="Enter ship name"
              />
            </div>
            {cloneError && <p className="text-red-400 text-sm mt-2">{cloneError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => { setShowCloneModal(false); setCloneError(''); }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={confirmClone}
              >
                {formData && templates.some(t => t.id === formData.id) ? 'Clone' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes modal */}
      {showUnsavedModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-[420px] border border-gray-700">
            <h2 className="text-xl font-bold mb-3 text-white">Unsaved Changes</h2>
            <p className="text-sm text-gray-300 mb-4">
              Save changes to "{formData?.name || 'this ship'}" before leaving?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleUnsavedDiscard}
                className="px-4 py-2 bg-red-800 border-2 border-red-400 text-white rounded hover:bg-red-700 transition"
              >
                Don't Save
              </button>
              <button
                onClick={handleUnsavedCancel}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleUnsavedSave}
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add optional components modal */}
      {showComponentsModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-5 rounded-lg w-[560px] max-h-[80vh] border border-gray-700 flex flex-col">
            <h2 className="text-lg font-bold mb-3 text-white">Add components</h2>
            <div className="flex-1 overflow-y-auto space-y-1">
              {components.filter(c => !c.builtIn).map(component => (
                <div key={component.id} className="flex items-center justify-between gap-2 bg-gray-700/50 rounded px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="text-[12px] text-gray-200">
                      {component.name}{' '}
                      <span className="text-gray-500">
                        ({component.mass}t · {component.crew} crew · {component.cost ? `${component.cost}gp` : '0gp'} · {component.hittable ? 'hittable' : 'safe'})
                      </span>
                    </div>
                    {component.effect && <div className="text-[10px] text-gray-400">{component.effect}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOptionalComponentCount(component.id, optionalComponentCount(component.id) + 1)}
                    className="flex-none px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition"
                  >
                    Add{optionalComponentCount(component.id) > 0 ? ` (${optionalComponentCount(component.id)})` : ''}
                  </button>
                </div>
              ))}
              {components.filter(c => !c.builtIn).length === 0 && (
                <div className="text-sm text-gray-500 text-center py-4">No optional components in the catalog.</div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => setShowComponentsModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card / slot context menu */}
      {cardMenu && formData && (() => {
        const key = cardMenu.data?.cardKey;
        const assigned = key ? formData.reinforcements.includes(key) : false;
        const canAdd = assigned || formData.reinforcements.length < formData.reinforcement;
        const canRemove = !!build?.deckLayout && !!cardMenu.region
          ? canRemoveLastEmptySlot(build.deckLayout, cardMenu.region)
          : false;
        const arcKey = cardMenu.data?.kind === 'weapon' ? cardMenu.data.cardKey : undefined;
        const arcs = arcKey && cardMenu.region
          ? effectiveWeaponArcs(cardMenu.region, formData.weaponArcs[arcKey])
          : [];
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setCardMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setCardMenu(null); }}
            />
            <div
              className="fixed z-50 w-56 max-h-[80vh] overflow-y-auto rounded border border-gray-600 bg-gray-800 p-1 shadow-xl"
              style={{
                left: Math.min(cardMenu.x, window.innerWidth - 240),
                top: Math.min(cardMenu.y, window.innerHeight - 480),
              }}
            >
              {cardMenu.data && (
                <div className="px-2 py-1 text-[10px] text-gray-400 truncate">
                  {cardMenu.data.name}
                </div>
              )}
              {key && (
                <>
                  <button
                    type="button"
                    onClick={() => toggleReinforcement(key)}
                    disabled={!canAdd}
                    className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {assigned ? 'Remove reinforcement' : 'Add reinforcement'}
                  </button>
                </>
              )}
              {cardMenu.region && (
                <>
                  <div className="my-1 border-t border-gray-700" />
                  <button
                    type="button"
                    onClick={addSlot}
                    className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-gray-700"
                  >
                    Add slot
                  </button>
                  <button
                    type="button"
                    onClick={removeSlot}
                    disabled={!canRemove}
                    title={canRemove ? 'Remove the bottom-most empty slot in this region' : 'No removable empty slot'}
                    className="w-full text-left px-2 py-1.5 text-xs rounded text-red-300 hover:bg-red-900/40 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Remove slot
                  </button>
                </>
              )}
              {arcKey && cardMenu.region && (
                <>
                  <div className="my-1 border-t border-gray-700" />
                  <div className="px-2 py-1 text-[10px] text-gray-400">
                    Firing arcs — click to toggle
                  </div>
                  <WeaponArcCompass
                    active={arcs}
                    locked={WEAPON_ARCS.filter(arc => isProtectedDefaultArc(cardMenu.region!, arc))}
                    onToggle={arc => setFiringArc(arc, arcs.includes(arc) ? 'remove' : 'add')}
                  />
                </>
              )}
              <button
                type="button"
                onClick={() => setCardMenu(null)}
                className="mt-1 w-full text-left px-2 py-1.5 text-xs rounded hover:bg-gray-700 text-gray-400"
              >
                Cancel
              </button>
            </div>
          </>
        );
      })()}

      {/* Ship image picker */}
      {showImagePicker && formData && (
        <ImagePickerModal
          current={formData.imageUrl}
          uploadKey={formData.id || 'new'}
          bucket="ship_images"
          title="Select Ship Image"
          showRaces={false}
          onSelect={(url) => {
            updateFormData('imageUrl', url ?? '');
            setShowImagePicker(false);
          }}
          onClose={() => setShowImagePicker(false)}
        />
      )}

      {/* Add / Edit Crew modal */}
      {showCrewModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-5 rounded-lg w-[420px] border border-gray-700">
            <h2 className="text-lg font-bold mb-3 text-white">{editingCrewIndex !== null ? 'Edit Crew' : 'Add Crew'}</h2>
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <Cell label="Number of crew" widthClass="w-24">
                  <NumInput value={crewDraft.count} min={1} max={999} onChange={(v) => setCrewDraft(d => ({ ...d, count: Math.max(1, Math.floor(v) || 1) }))} />
                </Cell>
                <Cell label="Name (optional — blank = unnamed)" widthClass="flex-1">
                  <input
                    type="text"
                    value={crewDraft.name}
                    onChange={(e) => setCrewDraft(d => ({ ...d, name: e.target.value }))}
                    className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                  />
                </Cell>
              </div>
              <div className="flex items-end gap-2">
                <Cell label="Level" widthClass="w-16">
                  <NumInput
                    value={crewDraft.level}
                    min={1}
                    max={99}
                    onChange={(v) => {
                      const level = Math.max(1, Math.floor(v) || 1);
                      setCrewDraft(d => ({
                        ...d,
                        level,
                        hp: crewDraftTouched.hp ? d.hp : computeCrewHp(level),
                        cost: crewDraftTouched.cost ? d.cost : computeCrewWeeklyCost(level),
                      }));
                    }}
                  />
                </Cell>
                <Cell label="HP" widthClass="w-16">
                  <NumInput
                    value={crewDraft.hp}
                    min={1}
                    max={999}
                    onChange={(v) => {
                      setCrewDraftTouched(t => ({ ...t, hp: true }));
                      setCrewDraft(d => ({ ...d, hp: Math.max(1, Math.floor(v) || 1) }));
                    }}
                  />
                </Cell>
                {([
                  ['Str', 'str'],
                  ['Dex', 'dex'],
                  ['Con', 'con'],
                  ['Int', 'int'],
                  ['Wis', 'wis'],
                  ['Cha', 'cha'],
                ] as const).map(([label, key]) => (
                  <Cell key={key} label={label}>
                    <NumInput
                      value={crewDraft[key]}
                      min={1}
                      max={30}
                      onChange={(v) => setCrewDraft(d => ({
                        ...d,
                        [key]: Math.max(1, Math.min(30, Math.floor(v) || DEFAULT_CREW_STATS[key])),
                      }))}
                    />
                  </Cell>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <Cell label="Weekly cost (gp)" widthClass="flex-1">
                  <NumInput
                    value={crewDraft.cost}
                    min={0}
                    step={1}
                    onChange={(v) => {
                      setCrewDraftTouched(t => ({ ...t, cost: true }));
                      setCrewDraft(d => ({ ...d, cost: Math.max(0, Math.floor(v)) }));
                    }}
                  />
                </Cell>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => { setShowCrewModal(false); setEditingCrewIndex(null); }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={confirmCrew}
              >
                {editingCrewIndex !== null ? 'Save' : `Add ${Math.max(1, crewDraft.count)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
