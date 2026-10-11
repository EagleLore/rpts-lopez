import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Building2, Search, Plus, Eye, X, AlertCircle,
  MapPin, FileText, User, Layers, ChevronRight, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  Card, Badge, Button, Modal, Input, Select, TextArea,
  EmptyState, PageHeader,
} from '@/components/ui';
import { formatDate, capitalize } from '@/lib/utils';
import {
  PROPERTY_CLASSIFICATIONS, UNIT_TYPES,
} from '@/lib/constants';
import type {
  Property, PropertyUnit, PropertyInterest, Party, Jurisdiction,
} from '@/lib/types';

// ---------- helpers ----------

const PROPERTY_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'retired', label: 'Retired' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'transferred', label: 'Transferred' },
];

const UNIT_TYPE_OPTIONS: { value: string; label: string }[] = UNIT_TYPES.map((t) => ({
  value: t,
  label: capitalize(t),
}));

const CLASSIFICATION_OPTIONS: { value: string; label: string }[] =
  PROPERTY_CLASSIFICATIONS.map((c) => ({ value: c, label: capitalize(c) }));

const PARTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'person', label: 'Person' },
  { value: 'organization', label: 'Organization' },
];

const INTEREST_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'declared_owner', label: 'Declared Owner' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'beneficial_user', label: 'Beneficial User' },
  { value: 'claimant', label: 'Claimant' },
  { value: 'payer', label: 'Payer' },
  { value: 'co_owner', label: 'Co-Owner' },
];

function notEmpty(v: string | null | undefined): boolean {
  return v !== null && v !== undefined && v.trim() !== '';
}

function display(v: string | null | undefined): string {
  return notEmpty(v) ? (v as string) : '—';
}

function ownerName(property: Property): string {
  const owner = property.interests?.find((i) => i.interest_type === 'declared_owner');
  return owner?.party?.name || '—';
}

function barangayName(j?: Jurisdiction): string {
  return j ? j.name : '—';
}

// ---------- main component ----------

export function PropertyRegistryPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [barangays, setBarangays] = useState<Jurisdiction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [search, setSearch] = useState('');
  const [barangayFilter, setBarangayFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // modals
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [showAddUnit, setShowAddUnit] = useState(false);

  // detail refresh state
  const [detailLoading, setDetailLoading] = useState(false);

  const loadProperties = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('properties')
      .select(
        `*, barangay:jurisdictions!barangay_id(id, code, name),
         units:property_units(*),
         interests:property_interests(*, party:parties(*))`
      )
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
      setProperties([]);
    } else {
      setProperties((data || []) as unknown as Property[]);
    }
    setLoading(false);
  }, []);

  const loadBarangays = useCallback(async () => {
    const { data } = await supabase
      .from('jurisdictions')
      .select('id, code, name, type, parent_id')
      .eq('type', 'barangay')
      .order('name', { ascending: true });
    setBarangays((data || []) as Jurisdiction[]);
  }, []);

  useEffect(() => {
    loadProperties();
    loadBarangays();
  }, [loadProperties, loadBarangays]);

  const refreshSelected = useCallback(async (propertyId: string) => {
    setDetailLoading(true);
    const { data } = await supabase
      .from('properties')
      .select(
        `*, barangay:jurisdictions!barangay_id(id, code, name),
         units:property_units(*),
         interests:property_interests(*, party:parties(*))`
      )
      .eq('id', propertyId)
      .single();
    if (data) {
      const refreshed = data as unknown as Property;
      setSelectedProperty(refreshed);
      // also update the list entry in-place
      setProperties((prev) =>
        prev.map((p) => (p.id === propertyId ? refreshed : p))
      );
    }
    setDetailLoading(false);
  }, []);

  // ---------- derived / filtered ----------

  const filteredProperties = useMemo(() => {
    const q = search.trim().toLowerCase();
    return properties.filter((p) => {
      if (barangayFilter && p.barangay_id !== barangayFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (q) {
        const hay = [
          p.pin,
          p.tax_declaration_number,
          ownerName(p),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [properties, search, barangayFilter, statusFilter]);

  const barangayOptions = useMemo(
    () => barangays.map((b) => ({ value: b.id, label: b.name })),
    [barangays]
  );

  // ---------- handlers ----------

  function handleView(property: Property) {
    setSelectedProperty(property);
  }

  function handleCloseDetail() {
    setSelectedProperty(null);
  }

  function handlePropertyCreated() {
    setShowAddProperty(false);
    loadProperties();
  }

  async function handleUnitCreated() {
    setShowAddUnit(false);
    if (selectedProperty) {
      await refreshSelected(selectedProperty.id);
    }
  }

  // ---------- render ----------

  return (
    <div>
      <PageHeader
        title="Property Registry"
        description="Register, search, and manage real property records in the municipality"
        action={
          <Button onClick={() => setShowAddProperty(true)}>
            <Plus className="h-4 w-4" />
            Register Property
          </Button>
        }
      />

      {/* error banner */}
      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-900">Failed to load properties</p>
            <p className="text-sm text-red-800 mt-0.5">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={loadProperties}>Retry</Button>
        </div>
      )}

      {/* filters */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="PIN, tax declaration no., or owner name"
                className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <Select
            label="Barangay"
            value={barangayFilter}
            onChange={setBarangayFilter}
            options={barangayOptions}
            placeholder="All barangays"
          />
          <Select
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={PROPERTY_STATUS_OPTIONS}
            placeholder="All statuses"
          />
        </div>
        {(search || barangayFilter || statusFilter) && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Showing {filteredProperties.length} of {properties.length} properties
            </p>
            <button
              className="text-xs font-medium text-blue-700 hover:text-blue-800"
              onClick={() => {
                setSearch('');
                setBarangayFilter('');
                setStatusFilter('');
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </Card>

      {/* list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-700" />
        </div>
      ) : filteredProperties.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title={properties.length === 0 ? 'No properties registered yet' : 'No properties match your filters'}
            description={
              properties.length === 0
                ? 'Register the first real property in the municipality to begin assessment and billing.'
                : 'Try adjusting your search terms or clearing the filters.'
            }
            action={
              properties.length === 0 ? (
                <Button onClick={() => setShowAddProperty(true)}>
                  <Plus className="h-4 w-4" />
                  Register Property
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('');
                    setBarangayFilter('');
                    setStatusFilter('');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">PIN</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Tax Decl. No.</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Owner</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Barangay</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredProperties.map((property) => (
                  <tr key={property.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {display(property.pin)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {display(property.tax_declaration_number)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {ownerName(property)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {barangayName(property.barangay)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={property.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" onClick={() => handleView(property)}>
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---------- detail modal ---------- */}
      <Modal
        open={!!selectedProperty}
        onClose={handleCloseDetail}
        title="Property Details"
        size="xl"
      >
        {selectedProperty && (
          <PropertyDetail
            property={selectedProperty}
            detailLoading={detailLoading}
            onAddUnit={() => setShowAddUnit(true)}
            onClose={handleCloseDetail}
          />
        )}
      </Modal>

      {/* ---------- add property modal ---------- */}
      <AddPropertyModal
        open={showAddProperty}
        onClose={() => setShowAddProperty(false)}
        barangays={barangays}
        onCreated={handlePropertyCreated}
      />

      {/* ---------- add unit modal ---------- */}
      <AddUnitModal
        open={showAddUnit}
        onClose={() => setShowAddUnit(false)}
        property={selectedProperty}
        onCreated={handleUnitCreated}
      />
    </div>
  );
}

// ---------- detail view ----------

interface PropertyDetailProps {
  property: Property;
  detailLoading: boolean;
  onAddUnit: () => void;
  onClose: () => void;
}

function PropertyDetail({ property, detailLoading, onAddUnit, onClose }: PropertyDetailProps) {
  const [parentProperty, setParentProperty] = useState<Property | null>(null);
  const [childProperties, setChildProperties] = useState<Property[]>([]);

  useEffect(() => {
    async function loadLineage() {
      if (property.parent_property_id) {
        const { data } = await supabase
          .from('properties')
          .select('id, pin, tax_declaration_number, status')
          .eq('id', property.parent_property_id)
          .single();
        if (data) setParentProperty(data as unknown as Property);
      } else {
        setParentProperty(null);
      }
      const { data: children } = await supabase
        .from('properties')
        .select('id, pin, tax_declaration_number, status')
        .eq('parent_property_id', property.id)
        .order('created_at', { ascending: true });
      setChildProperties((children || []) as unknown as Property[]);
    }
    loadLineage();
  }, [property.id, property.parent_property_id]);

  return (
    <div className="relative">
      {detailLoading && (
        <div className="absolute right-0 top-0 z-10 flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Refreshing…
        </div>
      )}

      {/* identifiers */}
      <SectionTitle icon={<FileText className="h-4 w-4" />} title="Property Identifiers" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 mb-6">
        <DetailField label="PIN" value={display(property.pin)} mono />
        <DetailField label="Tax Declaration No." value={display(property.tax_declaration_number)} mono />
        <DetailField label="ARP Number" value={display(property.arp_number)} mono />
        <DetailField label="Cadastral Lot No." value={display(property.cadastral_lot_number)} mono />
        <DetailField label="Survey Number" value={display(property.survey_number)} mono />
        <DetailField label="Title Number" value={display(property.title_number)} mono />
        {property.legacy_identifier && (
          <DetailField label="Legacy ID" value={display(property.legacy_identifier)} mono />
        )}
      </div>

      {/* status + location */}
      <SectionTitle icon={<MapPin className="h-4 w-4" />} title="Location & Status" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 mb-6">
        <DetailField label="Barangay" value={barangayName(property.barangay)} />
        <DetailField label="Location Address" value={display(property.location_address)} />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p>
          <div className="mt-1"><Badge status={property.status} /></div>
        </div>
        <DetailField label="Date Registered" value={formatDate(property.created_at)} />
      </div>

      {/* lineage */}
      {(parentProperty || childProperties.length > 0) && (
        <>
          <SectionTitle icon={<ChevronRight className="h-4 w-4" />} title="Property Lineage" />
          <div className="mb-6 space-y-2">
            {parentProperty && (
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                <span className="font-medium text-gray-500">Parent:</span>
                <span className="font-medium text-gray-900">{display(parentProperty.pin)}</span>
                <span className="text-gray-500">· {display(parentProperty.tax_declaration_number)}</span>
                <Badge status={parentProperty.status} />
              </div>
            )}
            {childProperties.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                <p className="font-medium text-gray-500 mb-1">Subdivisions / Children ({childProperties.length})</p>
                <ul className="space-y-1">
                  {childProperties.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <ChevronRight className="h-3 w-3 text-gray-400" />
                      <span className="font-medium text-gray-900">{display(c.pin)}</span>
                      <span className="text-gray-500">· {display(c.tax_declaration_number)}</span>
                      <Badge status={c.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}

      {/* units */}
      <div className="flex items-center justify-between mb-2">
        <SectionTitle icon={<Layers className="h-4 w-4" />} title="Property Units" inline />
        <Button size="sm" variant="outline" onClick={onAddUnit}>
          <Plus className="h-3.5 w-3.5" />
          Add Unit
        </Button>
      </div>
      {property.units && property.units.length > 0 ? (
        <div className="mb-6 space-y-3">
          {property.units.map((unit) => (
            <UnitCard key={unit.id} unit={unit} />
          ))}
        </div>
      ) : (
        <div className="mb-6 rounded-lg border border-dashed border-gray-300 p-6 text-center">
          <Layers className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">No property units recorded yet.</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={onAddUnit}>
            <Plus className="h-3.5 w-3.5" />
            Add Unit
          </Button>
        </div>
      )}

      {/* interests */}
      <SectionTitle icon={<User className="h-4 w-4" />} title="Interested Parties" />
      {property.interests && property.interests.length > 0 ? (
        <div className="mb-6 overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Party</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Interest</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Share</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {property.interests.map((interest) => (
                <tr key={interest.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm font-medium text-gray-900">
                    {interest.party?.name || '—'}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700">
                    {interest.party ? capitalize(interest.party.type) : '—'}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700">
                    {capitalize(interest.interest_type)}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700">
                    {interest.share_percentage != null ? `${interest.share_percentage}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700">
                    {interest.party?.contact_number || interest.party?.email || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-6 text-sm text-gray-500">No interested parties recorded.</p>
      )}

      <div className="flex justify-end pt-2 border-t border-gray-200">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

function UnitCard({ unit }: { unit: PropertyUnit }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Badge status={unit.unit_type === 'land' ? 'active' : unit.unit_type === 'building' ? 'issued' : 'prepared'} label={capitalize(unit.unit_type)} />
          <span className="text-sm font-semibold text-gray-900">{capitalize(unit.classification)}</span>
          {unit.is_exempt && <Badge status="active" label="Exempt" />}
        </div>
        <Badge status={unit.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {unit.area != null && (
          <DetailField label="Area" value={`${unit.area} ${unit.area_unit}`} />
        )}
        {unit.floor_area != null && (
          <DetailField label="Floor Area" value={`${unit.floor_area} sqm`} />
        )}
        {unit.actual_use && (
          <DetailField label="Actual Use" value={capitalize(unit.actual_use)} />
        )}
        {unit.construction_type && (
          <DetailField label="Construction" value={capitalize(unit.construction_type)} />
        )}
        {unit.year_built != null && (
          <DetailField label="Year Built" value={String(unit.year_built)} />
        )}
        {unit.age_years != null && (
          <DetailField label="Age" value={`${unit.age_years} yrs`} />
        )}
        {unit.acquisition_cost != null && (
          <DetailField label="Acquisition Cost" value={unit.acquisition_cost.toString()} />
        )}
        {unit.economic_life_years != null && (
          <DetailField label="Economic Life" value={`${unit.economic_life_years} yrs`} />
        )}
      </div>
      {unit.is_exempt && unit.exemption_basis && (
        <div className="mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
          <span className="font-medium">Exemption basis: </span>
          {unit.exemption_basis}
        </div>
      )}
      {unit.description && (
        <p className="mt-3 text-sm text-gray-600">{unit.description}</p>
      )}
    </div>
  );
}

// ---------- small presentational helpers ----------

function SectionTitle({ icon, title, inline }: { icon: React.ReactNode; title: string; inline?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${inline ? '' : 'mb-3'}`}>
      <span className="text-blue-700">{icon}</span>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{title}</h3>
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-0.5 text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

// ---------- add property modal ----------

interface AddPropertyModalProps {
  open: boolean;
  onClose: () => void;
  barangays: Jurisdiction[];
  onCreated: () => void;
}

function AddPropertyModal({ open, onClose, barangays, onCreated }: AddPropertyModalProps) {
  const [form, setForm] = useState({
    pin: '',
    tax_declaration_number: '',
    arp_number: '',
    cadastral_lot_number: '',
    survey_number: '',
    title_number: '',
    barangay_id: '',
    location_address: '',
    // owner / party
    party_name: '',
    party_type: 'person',
    contact_number: '',
    email: '',
    address: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const barangayOptions = useMemo(
    () => barangays.map((b) => ({ value: b.id, label: b.name })),
    [barangays]
  );

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function reset() {
    setForm({
      pin: '', tax_declaration_number: '', arp_number: '', cadastral_lot_number: '',
      survey_number: '', title_number: '', barangay_id: '', location_address: '',
      party_name: '', party_type: 'person', contact_number: '', email: '', address: '',
    });
    setSubmitError(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!form.pin.trim() && !form.tax_declaration_number.trim()) {
      setSubmitError('Either PIN or Tax Declaration Number is required.');
      return;
    }
    if (!form.party_name.trim()) {
      setSubmitError('Owner name is required.');
      return;
    }
    if (!form.barangay_id) {
      setSubmitError('Barangay is required.');
      return;
    }

    setSubmitting(true);
    try {
      // 1. upsert party (lookup by name to avoid duplicates)
      let partyId: string | null = null;
      const partyName = form.party_name.trim();

      const { data: existingParty } = await supabase
        .from('parties')
        .select('id')
        .ilike('name', partyName)
        .maybeSingle();

      if (existingParty) {
        partyId = existingParty.id as string;
      } else {
        const { data: newParty, error: partyError } = await supabase
          .from('parties')
          .insert({
            name: partyName,
            type: form.party_type,
            contact_number: form.contact_number || null,
            email: form.email || null,
            address: form.address || null,
          })
          .select('id')
          .single();
        if (partyError) throw new Error(partyError.message);
        partyId = newParty.id as string;
      }

      // 2. insert property
      const { data: property, error: propertyError } = await supabase
        .from('properties')
        .insert({
          pin: form.pin.trim() || null,
          tax_declaration_number: form.tax_declaration_number.trim() || null,
          arp_number: form.arp_number.trim() || null,
          cadastral_lot_number: form.cadastral_lot_number.trim() || null,
          survey_number: form.survey_number.trim() || null,
          title_number: form.title_number.trim() || null,
          barangay_id: form.barangay_id,
          location_address: form.location_address.trim() || null,
          status: 'active',
        })
        .select('id')
        .single();

      if (propertyError) throw new Error(propertyError.message);
      const propertyId = property.id as string;

      // 3. link party as declared_owner
      const { error: interestError } = await supabase
        .from('property_interests')
        .insert({
          property_id: propertyId,
          party_id: partyId,
          interest_type: 'declared_owner',
          share_percentage: null,
        });
      if (interestError) throw new Error(interestError.message);

      reset();
      onCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Register New Property" size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {submitError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-600 mt-0.5" />
            <p className="text-sm text-red-800">{submitError}</p>
          </div>
        )}

        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">Identifiers</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="PIN" value={form.pin} onChange={(v) => set('pin', v)} placeholder="e.g. 123-45-6789" />
            <Input label="Tax Declaration No." value={form.tax_declaration_number} onChange={(v) => set('tax_declaration_number', v)} placeholder="e.g. TD-2024-0001" />
            <Input label="ARP Number" value={form.arp_number} onChange={(v) => set('arp_number', v)} />
            <Input label="Cadastral Lot No." value={form.cadastral_lot_number} onChange={(v) => set('cadastral_lot_number', v)} />
            <Input label="Survey Number" value={form.survey_number} onChange={(v) => set('survey_number', v)} />
            <Input label="Title Number" value={form.title_number} onChange={(v) => set('title_number', v)} />
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">Location</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Barangay"
              value={form.barangay_id}
              onChange={(v) => set('barangay_id', v)}
              options={barangayOptions}
              placeholder="Select barangay"
              required
            />
            <Input label="Location Address" value={form.location_address} onChange={(v) => set('location_address', v)} placeholder="Street / sitio / landmarks" />
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">Declared Owner</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Owner Name" value={form.party_name} onChange={(v) => set('party_name', v)} placeholder="Person or organization name" required />
            <Select
              label="Party Type"
              value={form.party_type}
              onChange={(v) => set('party_type', v)}
              options={PARTY_TYPE_OPTIONS}
            />
            <Input label="Contact Number" value={form.contact_number} onChange={(v) => set('contact_number', v)} placeholder="09xx xxx xxxx" />
            <Input label="Email" value={form.email} onChange={(v) => set('email', v)} type="email" />
            <Input label="Address" value={form.address} onChange={(v) => set('address', v)} className="sm:col-span-2" />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Registering…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Register Property
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- add unit modal ----------

interface AddUnitModalProps {
  open: boolean;
  onClose: () => void;
  property: Property | null;
  onCreated: () => void;
}

function AddUnitModal({ open, onClose, property, onCreated }: AddUnitModalProps) {
  const [form, setForm] = useState({
    unit_type: 'land',
    classification: 'residential',
    actual_use: '',
    area: '',
    floor_area: '',
    construction_type: '',
    year_built: '',
    acquisition_cost: '',
    economic_life_years: '',
    description: '',
    is_exempt: 'false',
    exemption_basis: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function reset() {
    setForm({
      unit_type: 'land', classification: 'residential', actual_use: '',
      area: '', floor_area: '', construction_type: '', year_built: '',
      acquisition_cost: '', economic_life_years: '', description: '',
      is_exempt: 'false', exemption_basis: '',
    });
    setSubmitError(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!property) return;

    const areaNum = form.area.trim() ? Number(form.area) : null;
    const floorNum = form.floor_area.trim() ? Number(form.floor_area) : null;
    const yearNum = form.year_built.trim() ? Number(form.year_built) : null;
    const costNum = form.acquisition_cost.trim() ? Number(form.acquisition_cost) : null;
    const lifeNum = form.economic_life_years.trim() ? Number(form.economic_life_years) : null;
    const isExempt = form.is_exempt === 'true';

    if (form.area.trim() && (areaNum === null || isNaN(areaNum) || areaNum < 0)) {
      setSubmitError('Area must be a non-negative number.');
      return;
    }
    if (isExempt && !form.exemption_basis.trim()) {
      setSubmitError('Exemption basis is required when the unit is marked exempt.');
      return;
    }

    setSubmitting(true);
    try {
      const { error: unitError } = await supabase.from('property_units').insert({
        property_id: property.id,
        unit_type: form.unit_type,
        classification: form.classification,
        actual_use: form.actual_use.trim() || null,
        area: areaNum,
        area_unit: 'sqm',
        floor_area: floorNum,
        construction_type: form.construction_type.trim() || null,
        year_built: yearNum,
        acquisition_cost: costNum,
        economic_life_years: lifeNum,
        description: form.description.trim() || null,
        is_exempt: isExempt,
        exemption_basis: isExempt ? form.exemption_basis.trim() : null,
        status: 'active',
      });
      if (unitError) throw new Error(unitError.message);

      reset();
      onCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={`Add Unit — ${property ? display(property.pin) : ''}`} size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {submitError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-600 mt-0.5" />
            <p className="text-sm text-red-800">{submitError}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Unit Type" value={form.unit_type} onChange={(v) => set('unit_type', v)} options={UNIT_TYPE_OPTIONS} required />
          <Select label="Classification" value={form.classification} onChange={(v) => set('classification', v)} options={CLASSIFICATION_OPTIONS} required />
          <Input label="Actual Use" value={form.actual_use} onChange={(v) => set('actual_use', v)} placeholder="e.g. residential, commercial" />
          <Input label="Area (sqm)" value={form.area} onChange={(v) => set('area', v)} type="number" />
          <Input label="Floor Area (sqm)" value={form.floor_area} onChange={(v) => set('floor_area', v)} type="number" />
          <Input label="Construction Type" value={form.construction_type} onChange={(v) => set('construction_type', v)} placeholder="e.g. concrete, semi-concrete" />
          <Input label="Year Built" value={form.year_built} onChange={(v) => set('year_built', v)} type="number" />
          <Input label="Acquisition Cost" value={form.acquisition_cost} onChange={(v) => set('acquisition_cost', v)} type="number" />
          <Input label="Economic Life (years)" value={form.economic_life_years} onChange={(v) => set('economic_life_years', v)} type="number" />
        </div>

        <TextArea label="Description" value={form.description} onChange={(v) => set('description', v)} rows={2} />

        <div className="rounded-lg border border-gray-200 p-3">
          <Select
            label="Exempt Status"
            value={form.is_exempt}
            onChange={(v) => set('is_exempt', v)}
            options={[
              { value: 'false', label: 'Not exempt' },
              { value: 'true', label: 'Exempt' },
            ]}
          />
          {form.is_exempt === 'true' && (
            <div className="mt-3">
              <TextArea
                label="Exemption Basis"
                value={form.exemption_basis}
                onChange={(v) => set('exemption_basis', v)}
                rows={2}
                placeholder="Legal basis / proclamation reference"
                required
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add Unit
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
