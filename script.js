$(document).ready(async function() {
    // Constants
    const MSG_UNKNOWN_IPV6 = ":: (Yes, but unknown)";
    const UPDATE_DATE = new Date().toISOString().split('T')[0];
    
    // Set update date
    $('#updateDate').text(UPDATE_DATE);
    
    // UI Elements
    const loadingElement = $('#loading');
    const mapElement = $('#map');
    const tableElement = $('#serverTable');
    const showMapBtn = $('#showMapBtn');
    const showTableBtn = $('#showTableBtn');
    
    // Data sources
    const API_URLS = [
        "https://api.cors.lol/?url=https://api.protonmail.ch/vpn/logicals",
        "https://protonvpnmapproxy.privacyjam.com",
        "https://protonvpnmap.privacyjam.com/backup_logicals.json"
    ];
    
    // Initialize views
    let map = null;
    let markerCluster = null;
    let dataTable = null;
    
    // View management
    function showMap() {
        tableElement.hide();
        mapElement.show();
        showMapBtn.removeClass('btn-secondary').addClass('btn-primary');
        showTableBtn.removeClass('btn-primary').addClass('btn-secondary');
    }
    
    function showTable() {
        mapElement.hide();
        tableElement.show();
        showTableBtn.removeClass('btn-secondary').addClass('btn-primary');
        showMapBtn.removeClass('btn-primary').addClass('btn-secondary');
    }
    
    // Event listeners
    showMapBtn.click(showMap);
    showTableBtn.click(showTable);
    
    // Initialize map
    function initMap() {
        map = L.map('map', { 
            center: [20, 0], 
            zoom: 2, 
            zoomSnap: 0.5
        });
        
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        }).addTo(map);
        
        markerCluster = L.markerClusterGroup({
            maxClusterRadius: 20,
            disableClusteringAtZoom: 8,
            iconCreateFunction: (cluster) => {
                const childCount = cluster.getChildCount();
                let clusterClass = 'marker-cluster-small';
                if (childCount > 10) clusterClass = 'marker-cluster-medium';
                if (childCount > 50) clusterClass = 'marker-cluster-large';
                return new L.DivIcon({
                    html: `<div><span>${childCount}</span></div>`,
                    className: `marker-cluster ${clusterClass}`,
                    iconSize: [30, 30],
                });
            },
        });
    }
    
    // Parse CSV data
    function parseCSV(csvText) {
        const lines = csvText.split('\n');
        const headers = lines[0].split(',');
        const result = [];
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i]) continue;
            const obj = {};
            const currentline = lines[i].split(',');
            
            for (let j = 0; j < headers.length; j++) {
                obj[headers[j].trim()] = currentline[j] ? currentline[j].trim() : '';
            }
            result.push(obj);
        }
        
        return result;
    }
    
    // Fetch data from multiple sources with fallback
    async function fetchData() {
        for (let url of API_URLS) {
            try {
                const response = await fetch(url, {
                    method: "GET",
                    headers: { "Referrer-Policy": "no-referrer" }
                });
                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.warn(`Failed to fetch from ${url}:`, error);
            }
        }
        throw new Error("All API sources failed.");
    }
    
    // Process server data and populate both views
    async function processServerData() {
        try {
            loadingElement.text("Loading VPN server data...");
            
            // Fetch all required data
            const logicalsData = await fetchData();
            const ipv6Data = await fetch("nodes-ipv6.json").then(res => res.json());
            const ipInfoText = await fetch("ipinfo.csv").then(res => res.text());
            
            // Parse CSV data
            const ipInfoData = parseCSV(ipInfoText);
            
            if (!logicalsData.LogicalServers) throw new Error("Invalid server data");
            
            // Process data for table view
            const tableData = [];
            const locationGroups = {};
            
            logicalsData.LogicalServers.forEach(logical => {
                if (logical.Servers.length === 1) {
                    const server = logical.Servers[0];
                    const isp = ipInfoData.find(i => i.ip === server.ExitIP);
                    const location = logical.Location?.City || logical.EntryCountry;
                    
                    tableData.push([
                        logical.Domain,
                        logical.Name,
                        server.EntryIP,
                        server.ExitIP,
                        ipv6Data[logical.Domain] || (!!(16 & logical.Features) ? MSG_UNKNOWN_IPV6 : ""),
                        "",
                        isp ? isp.org : "",
                        location
                    ]);
                }
                
                if (logical.Location && logical.Location.Lat && logical.Location.Long) {
                    const key = `${logical.Location.Lat.toFixed(2)},${logical.Location.Long.toFixed(2)}`;
                    if (!locationGroups[key]) {
                        locationGroups[key] = [];
                    }
                    locationGroups[key].push(logical);
                }
            });
            
            // Guess Exit IPv6 Addresses for table view
            const hasIpv6 = tableData.filter(l => l[4] && l[4] !== "" && l[4] !== MSG_UNKNOWN_IPV6);
            
            hasIpv6.sort((a, b) => {
                const aNum = parseInt(a[1].split("#")[1] || "0");
                const bNum = parseInt(b[1].split("#")[1] || "0");
                return aNum - bNum;
            });
            
            const nodeGroups = {};
            hasIpv6.forEach(server => {
                const node = server[0];
                if (!nodeGroups[node]) {
                    nodeGroups[node] = [];
                }
                nodeGroups[node].push(server);
            });
            
            Object.values(nodeGroups).forEach(nodeGroup => {
                if (nodeGroup.length === 0) return;
                
                const firstServer = nodeGroup[0];
                const ipv6Parts = firstServer[4].split("::");
                if (ipv6Parts.length !== 2) return;
                
                const prefix = ipv6Parts[0];
                let suffixInt = parseInt(ipv6Parts[1], 16) || 0;

                if (suffixInt === 17) suffixInt = 16;
                if (suffixInt === 13) suffixInt = 32;
                
                nodeGroup.forEach(server => {
                    suffixInt++;
                    server[5] = `${prefix}::${suffixInt.toString(16)}`;
                });
            });
            
            // Initialize DataTable
            dataTable = $('#serverTable').DataTable({
                data: tableData,
                pageLength: 25,
                columns: [
                    { title: "Node" },
                    { title: "Server" },
                    { title: "Entry IPv4" },
                    { title: "Exit IPv4" },
                    { title: "Entry IPv6" },
                    { title: "Exit IPv6 (Guessed)" },
                    { title: "ISP" },
                    { title: "Location" }
                ],
                initComplete: function() {
                    loadingElement.hide();
                    showTable();
                }
            });
            
            // Populate map view
            initMap();
            
            const defaultIcon = L.icon({
                iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            });
            
            Object.entries(locationGroups).forEach(([key, servers]) => {
                const [lat, lon] = key.split(',').map(Number);
                const locationName = servers[0].City || servers[0].EntryCountry;
                
                let popupContent = `<b>${locationName}</b><br><b>${servers.length} Servers</b><br><div class="popup-content">`;
                
                servers.forEach(server => {
                    let smartRouting = server.HostCountry && server.HostCountry !== server.EntryCountry 
                        ? `<span style="color:red; font-weight:bold;">(Smart Routing from ${server.HostCountry})</span>` 
                        : '';
                    
                    let torServer = server.Name.includes("TOR") 
                        ? `<span style="color:purple; font-weight:bold;">(TOR Server)</span>` 
                        : '';
                    
                    let secureCore = (server.Features === 1 && server.EntryCountry !== server.ExitCountry) 
                        ? `<span style="color:orange; font-weight:bold;">(Secure Core from ${server.EntryCountry})</span>` 
                        : (server.Features === 1) 
                            ? `<span style="color:orange; font-weight:bold;">(Secure Core Server)</span>` 
                            : '';
                    
                    popupContent += `🔹 <b>${server.Name}</b> - Load: ${server.Load}% ${smartRouting} ${torServer} ${secureCore}<br>`;
                });
                
                popupContent += `</div>`;
                
                const marker = L.marker([lat, lon], { icon: defaultIcon })
                    .bindPopup(popupContent, { maxWidth: 350 });
                
                markerCluster.addLayer(marker);
            });
            
            map.addLayer(markerCluster);
            
        } catch (error) {
            loadingElement.text("Failed to load VPN server data. See console for details.");
            console.error("Error processing server data:", error);
        }
    }
    
    // Start the application
    processServerData();
});
