import { ADDON_PRICES_CENTS } from '@parkshield/shared';
import { notFound, redirect } from 'next/navigation';
import {
  serverApi,
  type OrderSummary,
  type PrintOptions,
  type Vehicle,
  type VehicleMode,
  type VehicleProtection,
} from '@/lib/api-server';
import { VehicleDetail } from './vehicle-detail';

export const metadata = { title: 'Fahrzeug', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function VehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  const { id } = await params;
  const { order } = await searchParams;
  const vid = encodeURIComponent(id);
  const [vehicle, orders, mode, protection, printOptions] = await Promise.all([
    serverApi<Vehicle>(`/v1/vehicles/${vid}`),
    serverApi<{ orders: OrderSummary[]; printPriceCents: number }>('/v1/orders'),
    serverApi<{ mode: VehicleMode | null }>(`/v1/vehicles/${vid}/mode`),
    serverApi<VehicleProtection>(`/v1/vehicles/${vid}/protection`),
    serverApi<PrintOptions>(`/v1/vehicles/${vid}/print-options`),
  ]);
  if (vehicle.status === 401) redirect('/anmelden');
  if (!vehicle.data) notFound();
  const printPriceCents = orders.data?.printPriceCents ?? ADDON_PRICES_CENTS.printShipped;
  return (
    <VehicleDetail
      vehicle={vehicle.data}
      mode={mode.data?.mode ?? null}
      protection={protection.data ?? { active: false, source: null, activeUntil: null }}
      orders={(orders.data?.orders ?? []).filter((o) => o.vehicleId === id)}
      printOptions={
        printOptions.data ?? {
          selfPrint: { priceCents: 0 },
          shipped: { priceCents: printPriceCents, free: false, welcomePrint: false },
        }
      }
      printPriceCents={printPriceCents}
      orderResult={order === 'paid' || order === 'canceled' ? order : undefined}
    />
  );
}
