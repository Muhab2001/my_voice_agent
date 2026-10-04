import type {
  Coordinates,
  DrizzleClient,
  LocationStore,
  SavedLocation,
} from '@voice/database'
import { userLocation } from '@voice/database/schema'
import { desc } from 'drizzle-orm'

export class LocationService implements LocationStore {
  constructor(private readonly client: DrizzleClient) {}

  async save(position: Coordinates): Promise<SavedLocation> {
    const [row] = await this.client
      .insert(userLocation)
      .values(position)
      .returning()

    if (!row) {
      throw new Error('Location save failed')
    }

    return row
  }

  async latest(): Promise<SavedLocation | null> {
    const [row] = await this.client
      .select()
      .from(userLocation)
      .orderBy(desc(userLocation.recordedAt), desc(userLocation.id))
      .limit(1)

    return row ?? null
  }
}
