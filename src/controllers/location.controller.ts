import L from "leaflet";
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      socket.emit("location", { latitude, longitude });
    },
    (error) => {
      console.error("Error getting location:", error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 5000,
    }
  );
}

const map = L.map("map").setView([0, 0], 2);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

interface MarkerMap {
  [key: string]: L.Marker;
}

const markers: MarkerMap = {};

socket.on("location", (data: { id: string; latitude: number; longitude: number }) => {
  const { id, latitude, longitude } = data;

  map.setView([latitude, longitude], 13);

  if (markers[id]) {
    markers[id].setLatLng([latitude, longitude]);
  } else {
    const marker = L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup("User here!")
      .openPopup();
    markers[id] = marker;
  }
});

socket.on("user-disconnected", (id: string) => {
  if (markers[id]) {
    map.removeLayer(markers[id]);
    delete markers[id];
  }
});
