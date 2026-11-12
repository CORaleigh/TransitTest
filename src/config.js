// §5 Config-driven, not hard-coded.
// All service URLs, portal item IDs, field names, camera positions, and tuning
// constants live here — the single source every module reads from. Nothing about
// the runtime environment is compiled into a component or feature module.
export const CONFIG = {
  camera: {
    position: { longitude: -78.6382, latitude: 35.7096, z: 4000 },
    tilt: 64,
    heading: 0
  },
  downtownCamera: {
    position: { longitude: -78.6381, latitude: 35.7624, z: 1000 },
    tilt: 60,
    heading: 0
  },
  routesUrl: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/GoRaleigh_Routes/FeatureServer/0",
  stopsUrl: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/GoRaleigh_BusStops/FeatureServer/0",
  realtimeVehiclesItemId: "90339540b1fd4678bf474ab1ab5abe73",
  buildingsItemId: "affa13965fe948cca694e356ef9a3004",
  refreshIntervalMinutes: 0.25,
  recentBusHours: 3,
  routeLineNameField: "full_name",
  routeIdField: "route_short_name",
  stopNameField: "Stop_Name",
  stopIdField: "Stop_ID",
  stopCodeField: "Stop_Code",
  vehicleRouteField: "trip_route_id",
  vehicleIdField: "vehicle_id",
  vehicleTimestampField: "vehicle_position_timestamp",
  vehicleStopField: "stop_id",
  vehicleStatusField: "current_status",
  vehicleBearingField: "bearing",
  vehicleSpeedField: "speed",
  buildingHighlightDistance: 1320, // feet, approximately 1/4 mile (0.25 * 5280 = 1320 feet)
  routeDirectionCueFeet: 2000,
  staleBusMinutes: 5 // a still-active bus older than this is flagged as stale
};
