"use strict";exports.id=6219,exports.ids=[6219],exports.modules={4328:(a,b,c)=>{function d(a,b){a.accDescr&&b.setAccDescription?.(a.accDescr),a.accTitle&&b.setAccTitle?.(a.accTitle),a.title&&b.setDiagramTitle?.(a.title)}c.d(b,{S:()=>d}),(0,c(95097).K)(d,"populateCommonDb")},46219:(a,b,c)=>{c.d(b,{diagram:()=>I});var d=c(4328),e=c(77893),f=c(37879),g=c(36594),h=c(58715),i=c(95097),j=c(92325),k={showLegend:!0,ticks:5,max:null,min:0,graticule:"circle"},l={axes:[],curves:[],options:k},m=structuredClone(l),n=g.UI.radar,o=(0,i.K)(()=>(0,f.$t)({...n,...(0,g.zj)().radar}),"getConfig"),p=(0,i.K)(()=>m.axes,"getAxes"),q=(0,i.K)(()=>m.curves,"getCurves"),r=(0,i.K)(()=>m.options,"getOptions"),s=(0,i.K)(a=>{m.axes=a.map(a=>({name:a.name,label:a.label??a.name}))},"setAxes"),t=(0,i.K)(a=>{m.curves=a.map(a=>({name:a.name,label:a.label??a.name,entries:u(a.entries)}))},"setCurves"),u=(0,i.K)(a=>{if(void 0==a[0].axis)return a.map(a=>a.value);let b=p();if(0===b.length)throw Error("Axes must be populated before curves for reference entries");return b.map(b=>{let c=a.find(a=>a.axis?.$refText===b.name);if(void 0===c)throw Error("Missing entry for axis "+b.label);return c.value})},"computeCurveEntries"),v={getAxes:p,getCurves:q,getOptions:r,setAxes:s,setCurves:t,setOptions:(0,i.K)(a=>{let b=a.reduce((a,b)=>(a[b.name]=b,a),{});m.options={showLegend:b.showLegend?.value??k.showLegend,ticks:b.ticks?.value??k.ticks,max:b.max?.value??k.max,min:b.min?.value??k.min,graticule:b.graticule?.value??k.graticule}},"setOptions"),getConfig:o,clear:(0,i.K)(()=>{(0,g.IU)(),m=structuredClone(l)},"clear"),setAccTitle:g.SV,getAccTitle:g.iN,setDiagramTitle:g.ke,getDiagramTitle:g.ab,getAccDescription:g.m7,setAccDescription:g.EI},w=(0,i.K)(a=>{(0,d.S)(a,v);let{axes:b,curves:c,options:e}=a;v.setAxes(b),v.setCurves(c),v.setOptions(e)},"populate"),x={parse:(0,i.K)(async a=>{let b=await (0,j.qg)("radar",a);h.R.debug(b),w(b)},"parse")},y=(0,i.K)((a,b,c,d)=>{let f=d.db,g=f.getAxes(),h=f.getCurves(),i=f.getOptions(),j=f.getConfig(),k=f.getDiagramTitle(),l=z((0,e.D)(b),j),m=i.max??Math.max(...h.map(a=>Math.max(...a.entries))),n=i.min,o=Math.min(j.width,j.height)/2;A(l,g,o,i.ticks,i.graticule),B(l,g,o,j),C(l,g,h,n,m,i.graticule,j),F(l,h,i.showLegend,j),l.append("text").attr("class","radarTitle").text(k).attr("x",0).attr("y",-j.height/2-j.marginTop)},"draw"),z=(0,i.K)((a,b)=>{let c=b.width+b.marginLeft+b.marginRight,d=b.height+b.marginTop+b.marginBottom,e={x:b.marginLeft+b.width/2,y:b.marginTop+b.height/2};return(0,g.a$)(a,d,c,b.useMaxWidth??!0),a.attr("viewBox",`0 0 ${c} ${d}`).attr("overflow","visible"),a.append("g").attr("transform",`translate(${e.x}, ${e.y})`)},"drawFrame"),A=(0,i.K)((a,b,c,d,e)=>{if("circle"===e)for(let b=0;b<d;b++){let e=c*(b+1)/d;a.append("circle").attr("r",e).attr("class","radarGraticule")}else if("polygon"===e){let e=b.length;for(let f=0;f<d;f++){let g=c*(f+1)/d,h=b.map((a,b)=>{let c=2*b*Math.PI/e-Math.PI/2,d=g*Math.cos(c),f=g*Math.sin(c);return`${d},${f}`}).join(" ");a.append("polygon").attr("points",h).attr("class","radarGraticule")}}},"drawGraticule"),B=(0,i.K)((a,b,c,d)=>{let e=b.length;for(let f=0;f<e;f++){let g=b[f].label,h=2*f*Math.PI/e-Math.PI/2,i=Math.cos(h),j=Math.sin(h);a.append("line").attr("x1",0).attr("y1",0).attr("x2",c*d.axisScaleFactor*i).attr("y2",c*d.axisScaleFactor*j).attr("class","radarAxisLine");let k=i>.01?"start":i<-.01?"end":"middle",l=j>.01?"hanging":j<-.01?"auto":"central";a.append("text").text(g).attr("x",c*d.axisLabelFactor*i+4*i).attr("y",c*d.axisLabelFactor*j+4*j).attr("text-anchor",k).attr("dominant-baseline",l).attr("class","radarAxisLabel")}},"drawAxes");function C(a,b,c,d,e,f,g){let h=b.length,i=Math.min(g.width,g.height)/2;c.forEach((b,c)=>{if(b.entries.length!==h)return;let j=b.entries.map((a,b)=>{let c=2*Math.PI*b/h-Math.PI/2,f=D(a,d,e,i);return{x:f*Math.cos(c),y:f*Math.sin(c)}});"circle"===f?a.append("path").attr("d",E(j,g.curveTension)).attr("class",`radarCurve-${c}`):"polygon"===f&&a.append("polygon").attr("points",j.map(a=>`${a.x},${a.y}`).join(" ")).attr("class",`radarCurve-${c}`)})}function D(a,b,c,d){return d*(Math.min(Math.max(a,b),c)-b)/(c-b)}function E(a,b){let c=a.length,d=`M${a[0].x},${a[0].y}`;for(let e=0;e<c;e++){let f=a[(e-1+c)%c],g=a[e],h=a[(e+1)%c],i=a[(e+2)%c],j={x:g.x+(h.x-f.x)*b,y:g.y+(h.y-f.y)*b},k={x:h.x-(i.x-g.x)*b,y:h.y-(i.y-g.y)*b};d+=` C${j.x},${j.y} ${k.x},${k.y} ${h.x},${h.y}`}return`${d} Z`}function F(a,b,c,d){if(!c)return;let e=(d.width/2+d.marginRight)*3/4,f=-(3*(d.height/2+d.marginTop))/4;b.forEach((b,c)=>{let d=a.append("g").attr("transform",`translate(${e}, ${f+20*c})`);d.append("rect").attr("width",12).attr("height",12).attr("class",`radarLegendBox-${c}`),d.append("text").attr("x",16).attr("y",0).attr("class","radarLegendText").text(b.label)})}(0,i.K)(C,"drawCurves"),(0,i.K)(D,"relativeRadius"),(0,i.K)(E,"closedRoundCurve"),(0,i.K)(F,"drawLegend");var G=(0,i.K)((a,b)=>{let c="";for(let d=0;d<a.THEME_COLOR_LIMIT;d++){let e=a[`cScale${d}`];c+=`
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
		`}return c},"genIndexStyles"),H=(0,i.K)(a=>{let b=(0,g.P$)(),c=(0,g.zj)(),d=(0,f.$t)(b,c.themeVariables),e=(0,f.$t)(d.radar,a);return{themeVariables:d,radarOptions:e}},"buildRadarStyleOptions"),I={parser:x,db:v,renderer:{draw:y},styles:(0,i.K)(({radar:a}={})=>{let{themeVariables:b,radarOptions:c}=H(a);return`
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
	${G(b,c)}
	`},"styles")}}};