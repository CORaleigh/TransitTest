// §3 One place for genuinely shared app state — the "single Context" analog for
// this buildless vanilla app. Feature-local state stays inside its own feature
// module; only cross-cutting values that multiple features read/write live here.
export const state = {
  selectedBusObjectId: null,
  selectedBusVehicleId: null,
  followingBus: false,
  lastSelectedBusLocation: null,
  currentRouteFilter: "",
  routeKeys: [],
  fields: {},
  highlightedBuildingIds: [],
  schematicRoute: null,
  schematicCache: null,
  schematicDismissed: false,
  stopNameById: null,
  selectedBuildings: [],
  liveFollowQueued: false,
  busArrivalAnimationFrame: null,
  busArrivalCueRequest: 0
};
