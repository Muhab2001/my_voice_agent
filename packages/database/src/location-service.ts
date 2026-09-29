import { desc } from 'drizzle-orm'
import type { DrizzleClient } from './index.js'
import { userLocation } from './schema.js'

export type Coordinates = {
  latitude: number
  longitude: number
  accuracyMeters: number
}

export type SavedLocation = Coordinates & { recordedAt: Date }

/** Stores browser supplied positions and reads the freshest position for this single-user app. */
export interface LocationService {
  save(position: Coordinates): Promise<SavedLocation>
  latest(): Promise<SavedLocation | null>
}

export class DrizzleLocationService implements LocationService {
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
