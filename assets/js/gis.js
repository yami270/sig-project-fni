'use strict';

require([
    "esri/widgets/Sketch/SketchViewModel",
    "esri/geometry/Polyline",
    "esri/Graphic",
	'esri/config',
	'esri/Map',
	'esri/views/MapView',
	'esri/layers/FeatureLayer',
    "esri/layers/GraphicsLayer",
    "esri/geometry/geometryEngine",
    "esri/core/watchUtils",
    "dojo/domReady!",
], function (
    SketchViewModel, 
    Polyline,
    Graphic,
    esriConfig, 
    Map, 
    MapView, 
    FeatureLayer, 
    GraphicsLayer,
    geometryEngine,
    watchUtils){
    // Variables globales
    let view;
    let sketchViewModel, featureLayerView, pausableWatchHandle;
    let count = 0,
      centerGraphic,
      edgeGraphic,
      polylineGraphic,
      bufferGraphic,
      centerGeometryAtStart,
      labelGraphic;
    const unit = "meters";
    
    // Configuracion de credenciales
	esriConfig.apiKey = "AAPKdcdc0ab5250240d9ab5de93d4cb462aeBOHGFiKYV8SZkSeVHaC_QIyjE6G00Izit6tuEO9ApgKWJld9PXSw5bCqOq2Ds0BD"
    
    // Funciones y variables de apoyo
    let time_current;
    function convert_date_format(str){
        str = "00000"+str;
        let str_len = str.length;
        str = str.substr(str_len-4, 2)+":"+str.substr(str_len-2, 2);
        return str;
    }

    function get_menu_str(menu_json){
        let menu = menu_json.replace(/\\/g, '');
        menu = JSON.parse(menu);
        let str = `
        <table>
            <tr>
                <th>Nombre</th>
                <th>Precio</th>
            </tr>`;
        menu['menu'].forEach(element => {
            str += `
            <tr>
                <td>${element.nombre}</td>
                <td>${element.precio}</td>
            </tr>
            `;
        });

        str += "</table>";
        return str;
    }

	// Definiendo el renderer para las ubicaciones
	let pointsRenderer = {
		type: "simple", 
		symbol: {
			type: "web-style",
			name: "tear-pin-1",
  			styleName: "Esri2DPointSymbolsStyle"
		},
	};
	
    // Defincion de la template para los datos
	const template = {
		title: "{name}",
        content: set_popup_content,
	};
	
    // Create layers
    const graphicsLayer = new GraphicsLayer();
    const bufferLayer = new GraphicsLayer({
        blendMode: "hard-light"
    });
	const roads_map = new FeatureLayer({
    	url: "https://services7.arcgis.com/WvzPGhomAxRA9Pn9/arcgis/rest/services/roadsfni/FeatureServer/0",
  	});
    
    // Carga la capa requerida
    let objetive_layer;
    switch(name_map){
        case 'mid-morning-meal': 
            objetive_layer = new FeatureLayer({
                    url: "https://services7.arcgis.com/WvzPGhomAxRA9Pn9/arcgis/rest/services/midmorningmeal/FeatureServer/0",
                    renderer: pointsRenderer,
                    popupTemplate: template,
                    outFields: ["*"],
                });
            break;
        case 'drinks': 
            objetive_layer = new FeatureLayer({
                    url: "https://services7.arcgis.com/WvzPGhomAxRA9Pn9/arcgis/rest/services/drinksfni/FeatureServer/0",
                    renderer: pointsRenderer,
                    popupTemplate: template,
                    outFields: ["*"],
                });
            break;
        case 'kioskos': 
            objetive_layer = new FeatureLayer({
                    url: "https://services6.arcgis.com/avOvTSL5WAqL6vnT/arcgis/rest/services/kioskos_fni/FeatureServer/0",
                    renderer: pointsRenderer,
                    popupTemplate: template,
                    outFields: ["*"],
                });
            break;
        case 'snacks': 
            objetive_layer = new FeatureLayer({
                    url: "https://services6.arcgis.com/avOvTSL5WAqL6vnT/arcgis/rest/services/snacks/FeatureServer/0",
                    renderer: pointsRenderer,
                    popupTemplate: template,
                    outFields: ["*"],
                });
            break;
        default:
            alert("ERROR");
            break;
    }

    // Cargando mapa base y ajuntando capas
	const map = new Map({
        basemap: "arcgis-imagery",
        layers: [roads_map, bufferLayer, graphicsLayer, objetive_layer]
    });

    // Visualizacion del mapa
	view = new MapView({
		container: 'view-'+name_map,
		map: map,
		center: [-67.13657471130101, -17.991011748535595],
		zoom: 17,
		rotation: 90,
		popup: {
			dockEnabled: true,
			dockOptions: {
				buttonEnabled: false,
				breakpoint: false,
				position: 'top-right'
			},
            visibleElements: {
                closeButton: false,
            }
		}
	});
    
	function set_popup_content(feature){
        time_current = (new Date()).getHours()*100 + (new Date()).getMinutes();
        let data_point = feature.graphic.attributes;
        let schedule_begin = convert_date_format(data_point['schedule_begin']);
        let schedule_end = convert_date_format(data_point['schedule_end']);
        let is_open = parseInt(data_point['schedule_begin']) <= time_current && time_current <= parseInt(data_point['schedule_end']);
        let menu = get_menu_str(data_point['menu']);
        // Crea la plantilla del popup
        let content_template =`
            <strong>Horario de atención: </strong> ${schedule_begin}-${schedule_end}
            ${(is_open)?"<p style='color: green'><b>ABIERTO</b></p>":"<p style='color: red'><b>CERRADO</b></p>"}
            <strong>MENU</strong> 
            ${menu}`;
        view.popup.open({title: data_point['name'], content: content_template});
    }

    // Actualizando interfaz
    setUpAppUI();
    setUpSketch();

    function setUpAppUI() {
        view.whenLayerView(roads_map).then(function (layerView) {
            featureLayerView = layerView;
            pausableWatchHandle = watchUtils.pausable(
                layerView,
                "updating",
                async (val) => {
                    if (!val) {
                        await drawBufferPolygon();
                        // Muestra las instrucciones solo al iniciar
                        if (count == 0) {
                            view.popup.open({
                                title: "Punto central",
                                content:
                                    "Arrastra este punto para mover el buffer.<br/> " +
                                    "O arrastra el punto <b>Borde</b> para redimensionar el buffer.",
                                    location: centerGraphic.geometry
                            });
                            view.popup.alignment = "top-left";
                            count = 1;
                        }
                    }
                }
            );
        });
    }

    function setUpSketch() {
        sketchViewModel = new SketchViewModel({
            view: view,
            layer: graphicsLayer,
        });
        // Cuando se seleccione un punto que permita la edicion del buffer
        sketchViewModel.on("update", onMove);
    }

    // Actualiza el buffer cuando se mueve un punto
    function onMove(event) {
        if (
            event.toolEventInfo &&
            event.toolEventInfo.mover.attributes.edge
        ) {
            const toolType = event.toolEventInfo.type;
            if (toolType === "move-start") {
            centerGeometryAtStart = centerGraphic.geometry;
            }
            else if (toolType === "move" || toolType === "move-stop") {
            centerGraphic.geometry = centerGeometryAtStart;
            }
        }

        const vertices = [
            [centerGraphic.geometry.x, centerGraphic.geometry.y],
            [edgeGraphic.geometry.x, edgeGraphic.geometry.y]
        ];

        calculateBuffer(vertices);
    }

    // Actualiza la informacion geometrica del buffer
    function calculateBuffer(vertices) {
        polylineGraphic.geometry = new Polyline({
            paths: vertices,
            spatialReference: view.spatialReference
        });

        const length = geometryEngine.geodesicLength(
            polylineGraphic.geometry,
            unit
        );
        const buffer = geometryEngine.geodesicBuffer(
            centerGraphic.geometry,
            length,
            unit
        );

        bufferGraphic.geometry = buffer;
        labelGraphic.geometry = edgeGraphic.geometry;
        labelGraphic.symbol = {
            type: "text",
            color: "#5ffefe",
            text: length.toFixed(2) + " metros - " + (length/50).toFixed(2) + " minutos",
            xoffset: 50,
            yoffset: 10,
            font: {
                size: 14,
                family: "sans-serif"
            }
        };
    }

    // Dibuja el buffer cuando se mueven los puntos
    function drawBufferPolygon() {
        pausableWatchHandle.pause();
        const viewCenter = view.center.clone();
        const centerScreenPoint = view.toScreen(viewCenter);
        const centerPoint = view.toMap({
            x: centerScreenPoint.x + 120,
            y: centerScreenPoint.y - 120
        });
        const edgePoint = view.toMap({
            x: centerScreenPoint.x + 240,
            y: centerScreenPoint.y - 120
        });

        const vertices = [
            [centerPoint.x, centerPoint.y],
            [edgePoint.x, edgePoint.y]
        ];

        if (!centerGraphic) {
            const polyline = new Polyline({
                paths: vertices,
                spatialReference: view.spatialReference
            });

            const length = geometryEngine.geodesicLength(polyline, unit);
            const buffer = geometryEngine.geodesicBuffer(
                centerPoint,
                length,
                unit
            );
            
            const pointSymbol = {
                type: "simple-marker",
                style: "circle",
                size: 10,
                color: [0, 255, 255, 0.5]
            };
            centerGraphic = new Graphic({
                geometry: centerPoint,
                symbol: pointSymbol,
                attributes: {
                    center: "center"
                }
            });

            edgeGraphic = new Graphic({
                geometry: edgePoint,
                symbol: pointSymbol,
                attributes: {
                    edge: "edge"
                }
            });

            polylineGraphic = new Graphic({
                geometry: polyline,
                symbol: {
                    type: "simple-line",
                    color: [254, 254, 254, 1],
                    width: 2.5
                }
            });

            bufferGraphic = new Graphic({
                geometry: buffer,
                symbol: {
                    type: "simple-fill",
                    color: [150, 150, 150],
                    outline: {
                    color: "#5ffefe",
                    width: 2
                    }
                }
            });
            labelGraphic = labelLength(edgePoint, length);

            graphicsLayer.addMany([
                centerGraphic,
                edgeGraphic,
                polylineGraphic
            ]);
            view.graphics.add(labelGraphic);
            bufferLayer.addMany([bufferGraphic]);
        }
        else {
            centerGraphic.geometry = centerPoint;
            edgeGraphic.geometry = edgePoint;
        }
        calculateBuffer(vertices);
    }

    // Define la descripcion del buffer
    function labelLength(geom, length) {
        return new Graphic({
            geometry: geom,
            symbol: {
                type: "text",
                color: "#5ffefe",
                text: length.toFixed(2) + " metros - " + (length/50).toFixed(2) + " minutos",
                xoffset: 50,
                yoffset: 10,
                font: {
                    size: 14,
                    family: "sans-serif"
                }
            }
        });
    }
});