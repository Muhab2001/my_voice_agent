export type Coordinates = {
  latitude: number
  longitude: number
  accuracyMeters: number
}

export type SavedLocation = Coordinates & { recordedAt: Date }

/** Stores browser supplied positions and reads the freshest position for this single-user app. */
export interface LocationStore {
  save(position: Coordinates): Promise<SavedLocation>
  latest(): Promise<SavedLocation | null>
}
