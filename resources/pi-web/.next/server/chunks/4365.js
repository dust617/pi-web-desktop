"use strict";exports.id=4365,exports.ids=[4365],exports.modules={93273:(a,b,c)=>{function d(a,b){a.accDescr&&b.setAccDescription?.(a.accDescr),a.accTitle&&b.setAccTitle?.(a.accTitle),a.title&&b.setDiagramTitle?.(a.title)}c.d(b,{S:()=>d}),(0,c(21143).K2)(d,"populateCommonDb")},94365:(a,b,c)=>{c.d(b,{diagram:()=>H});var d=c(47596),e=c(93273),f=c(40684),g=c(46629),h=c(21143),i=c(92325),j={showLegend:!0,ticks:5,max:null,min:0,graticule:"circle"},k={axes:[],curves:[],options:j},l=structuredClone(k),m=g.UI.radar,n=(0,h.K2)(()=>(0,f.$t)({...m,...(0,g.zj)().radar}),"getConfig"),o=(0,h.K2)(()=>l.axes,"getAxes"),p=(0,h.K2)(()=>l.curves,"getCurves"),q=(0,h.K2)(()=>l.options,"getOptions"),r=(0,h.K2)(a=>{l.axes=a.map(a=>({name:a.name,label:a.label??a.name}))},"setAxes"),s=(0,h.K2)(a=>{l.curves=a.map(a=>({name:a.name,label:a.label??a.name,entries:t(a.entries)}))},"setCurves"),t=(0,h.K2)(a=>{if(void 0==a[0].axis)return a.map(a=>a.value);let b=o();if(0===b.length)throw Error("Axes must be populated before curves for reference entries");return b.map(b=>{let c=a.find(a=>a.axis?.$refText===b.name);if(void 0===c)throw Error("Missing entry for axis "+b.label);return c.value})},"computeCurveEntries"),u={getAxes:o,getCurves:p,getOptions:q,setAxes:r,setCurves:s,setOptions:(0,h.K2)(a=>{let b=a.reduce((a,b)=>(a[b.name]=b,a),{});l.options={showLegend:b.showLegend?.value??j.showLegend,ticks:b.ticks?.value??j.ticks,max:b.max?.value??j.max,min:b.min?.value??j.min,graticule:b.graticule?.value??j.graticule}},"setOptions"),getConfig:n,clear:(0,h.K2)(()=>{(0,g.IU)(),l=structuredClone(k)},"clear"),setAccTitle:g.SV,getAccTitle:g.iN,setDiagramTitle:g.ke,getDiagramTitle:g.ab,getAccDescription:g.m7,setAccDescription:g.EI},v=(0,h.K2)(a=>{(0,e.S)(a,u);let{axes:b,curves:c,options:d}=a;u.setAxes(b),u.setCurves(c),u.setOptions(d)},"populate"),w={parse:(0,h.K2)(async a=>{let b=await (0,i.qg)("radar",a);h.Rm.debug(b),v(b)},"parse")},x=(0,h.K2)((a,b,c,e)=>{let f=e.db,g=f.getAxes(),h=f.getCurves(),i=f.getOptions(),j=f.getConfig(),k=f.getDiagramTitle(),l=y((0,d.D)(b),j),m=i.max??Math.max(...h.map(a=>Math.max(...a.entries))),n=i.min,o=Math.min(j.width,j.height)/2;z(l,g,o,i.ticks,i.graticule),A(l,g,o,j),B(l,g,h,n,m,i.graticule,j),E(l,h,i.showLegend,j),l.append("text").attr("class","radarTitle").text(k).attr("x",0).attr("y",-j.height/2-j.marginTop)},"draw"),y=(0,h.K2)((a,b)=>{let c=b.width+b.marginLeft+b.marginRight,d=b.height+b.marginTop+b.marginBottom,e={x:b.marginLeft+b.width/2,y:b.marginTop+b.height/2};return(0,g.a$)(a,d,c,b.useMaxWidth??!0),a.attr("viewBox",`0 0 ${c} ${d}`),a.append("g").attr("transform",`translate(${e.x}, ${e.y})`)},"drawFrame"),z=(0,h.K2)((a,b,c,d,e)=>{if("circle"===e)for(let b=0;b<d;b++){let e=c*(b+1)/d;a.append("circle").attr("r",e).attr("class","radarGraticule")}else if("polygon"===e){let e=b.length;for(let f=0;f<d;f++){let g=c*(f+1)/d,h=b.map((a,b)=>{let c=2*b*Math.PI/e-Math.PI/2,d=g*Math.cos(c),f=g*Math.sin(c);return`${d},${f}`}).join(" ");a.append("polygon").attr("points",h).attr("class","radarGraticule")}}},"drawGraticule"),A=(0,h.K2)((a,b,c,d)=>{let e=b.length;for(let f=0;f<e;f++){let g=b[f].label,h=2*f*Math.PI/e-Math.PI/2;a.append("line").attr("x1",0).attr("y1",0).attr("x2",c*d.axisScaleFactor*Math.cos(h)).attr("y2",c*d.axisScaleFactor*Math.sin(h)).attr("class","radarAxisLine"),a.append("text").text(g).attr("x",c*d.axisLabelFactor*Math.cos(h)).attr("y",c*d.axisLabelFactor*Math.sin(h)).attr("class","radarAxisLabel")}},"drawAxes");function B(a,b,c,d,e,f,g){let h=b.length,i=Math.min(g.width,g.height)/2;c.forEach((b,c)=>{if(b.entries.length!==h)return;let j=b.entries.map((a,b)=>{let c=2*Math.PI*b/h-Math.PI/2,f=C(a,d,e,i);return{x:f*Math.cos(c),y:f*Math.sin(c)}});"circle"===f?a.append("path").attr("d",D(j,g.curveTension)).attr("class",`radarCurve-${c}`):"polygon"===f&&a.append("polygon").attr("points",j.map(a=>`${a.x},${a.y}`).join(" ")).attr("class",`radarCurve-${c}`)})}function C(a,b,c,d){return d*(Math.min(Math.max(a,b),c)-b)/(c-b)}function D(a,b){let c=a.length,d=`M${a[0].x},${a[0].y}`;for(let e=0;e<c;e++){let f=a[(e-1+c)%c],g=a[e],h=a[(e+1)%c],i=a[(e+2)%c],j={x:g.x+(h.x-f.x)*b,y:g.y+(h.y-f.y)*b},k={x:h.x-(i.x-g.x)*b,y:h.y-(i.y-g.y)*b};d+=` C${j.x},${j.y} ${k.x},${k.y} ${h.x},${h.y}`}return`${d} Z`}function E(a,b,c,d){if(!c)return;let e=(d.width/2+d.marginRight)*3/4,f=-(3*(d.height/2+d.marginTop))/4;b.forEach((b,c)=>{let d=a.append("g").attr("transform",`translate(${e}, ${f+20*c})`);d.append("rect").attr("width",12).attr("height",12).attr("class",`radarLegendBox-${c}`),d.append("text").attr("x",16).attr("y",0).attr("class","radarLegendText").text(b.label)})}(0,h.K2)(B,"drawCurves"),(0,h.K2)(C,"relativeRadius"),(0,h.K2)(D,"closedRoundCurve"),(0,h.K2)(E,"drawLegend");var F=(0,h.K2)((a,b)=>{let c="";for(let d=0;d<a.THEME_COLOR_LIMIT;d++){let e=a[`cScale${d}`];c+=`
		.radarCurve-${d} {
			color: ${e};
			fill: ${e};
			fill-opacity: ${b.curveOpacity};
			stroke: ${e};
			stroke-width: ${b.curveStrokeWidth};
		}
		.radarLegendBox-${d} {
			fill: ${e};
			fill-opacity: ${b.curveOpacity};
			stroke: ${e};
		}
		`}return c},"genIndexStyles"),G=(0,h.K2)(a=>{let b=(0,g.P$)(),c=(0,g.zj)(),d=(0,f.$t)(b,c.themeVariables),e=(0,f.$t)(d.radar,a);return{themeVariables:d,radarOptions:e}},"buildRadarStyleOptions"),H={parser:w,db:u,renderer:{draw:x},styles:(0,h.K2)(({radar:a}={})=>{let{themeVariables:b,radarOptions:c}=G(a);return`
	.radarTitle {
		font-size: ${b.fontSize};
		color: ${b.titleColor};
		dominant-baseline: hanging;
		text-anchor: middle;
	}
	.radarAxisLine {
		stroke: ${c.axisColor};
		stroke-width: ${c.axisStrokeWidth};
	}
	.radarAxisLabel {
		dominant-baseline: middle;
		text-anchor: middle;
		font-size: ${c.axisLabelFontSize}px;
		color: ${c.axisColor};
	}
	.radarGraticule {
		fill: ${c.graticuleColor};
		fill-opacity: ${c.graticuleOpacity};
		stroke: ${c.graticuleColor};
		stroke-width: ${c.graticuleStrokeWidth};
	}
	.radarLegendText {
		text-anchor: start;
		font-size: ${c.legendFontSize}px;
		dominant-baseline: hanging;
	}
	${F(b,c)}
	`},"styles")}}};