"use strict";exports.id=46,exports.ids=[46],exports.modules={4328:(a,b,c)=>{function d(a,b){a.accDescr&&b.setAccDescription?.(a.accDescr),a.accTitle&&b.setAccTitle?.(a.accTitle),a.title&&b.setDiagramTitle?.(a.title)}c.d(b,{S:()=>d}),(0,c(95097).K)(d,"populateCommonDb")},70046:(a,b,c)=>{c.d(b,{diagram:()=>C});var d=c(4328),e=c(77893),f=c(37879),g=c(36594),h=c(58715),i=c(95097),j=c(92325),k=(0,i.K)(()=>({domains:new Map,transitions:[]}),"createDefaultData"),l=k(),m=(0,i.K)(()=>l.domains,"getDomains"),n={getDomains:m,getTransitions:(0,i.K)(()=>l.transitions,"getTransitions"),setDomains:(0,i.K)(a=>{if(a)for(let b of a){let a=b.domain,c=(b.items??[]).map(a=>({label:a.label}));l.domains.set(a,{name:a,items:c})}},"setDomains"),setTransitions:(0,i.K)(a=>{a&&(l.transitions=a.filter(a=>a.from!==a.to||(h.R.warn(`Cynefin: self-loop transition on domain "${a.from}" is not meaningful and will be skipped.`),!1)).map(a=>({from:a.from,to:a.to,label:a.label||void 0})))},"setTransitions"),getConfig:(0,i.K)(()=>(0,f.$t)({...g.UI.cynefin,...(0,g.zj)().cynefin}),"getConfig"),clear:(0,i.K)(()=>{(0,g.IU)(),l=k()},"clear"),setAccTitle:g.SV,getAccTitle:g.iN,setDiagramTitle:g.ke,getDiagramTitle:g.ab,getAccDescription:g.m7,setAccDescription:g.EI},o=(0,i.K)(a=>{(0,d.S)(a,n),n.setDomains(a.domains),n.setTransitions(a.transitions)},"populate"),p={parse:(0,i.K)(async a=>{let b=await (0,j.qg)("cynefin",a);h.R.debug(b),o(b)},"parse")};function q(a){let b=a+0x6d2b79f5|0;return b=Math.imul(b^b>>>15,1|b),(((b^=b+Math.imul(b^b>>>7,61|b))^b>>>14)>>>0)/0x100000000}function r(a){let b=0;for(let c=0;c<a.length;c++)b=(b<<5)-b+a.charCodeAt(c)|0;return b}function s(a,b){return"number"==typeof a&&Number.isFinite(a)&&0!==a?a:r(b)}function t(a,b,c,d){let e=a/2,f=d??.015*a,g=b/7,h=[];for(let a=0;a<=7;a++){let b=q(c+17*a)*f*2-f;h.push({x:e+b,y:a*g})}let i=`M${h[0].x},${h[0].y}`;for(let a=0;a<h.length-1;a++){let b=h[a],d=h[a+1],e=(b.y+d.y)/2,g=1.5*f*(a%2==0?1:-1)*q(c+31*a+7),j=b.x+g,k=d.x-g;i+=` C${j},${e} ${k},${e} ${d.x},${d.y}`}return i}function u(a,b,c,d){let e=b/2,f=d??.015*b,g=a/7,h=[];for(let a=0;a<=7;a++){let b=q(c+23*a)*f*2-f;h.push({x:a*g,y:e+b})}let i=`M${h[0].x},${h[0].y}`;for(let a=0;a<h.length-1;a++){let b=h[a],d=h[a+1],e=(b.x+d.x)/2,g=1.5*f*(a%2==0?1:-1)*q(c+37*a+11),j=b.y+g,k=d.y-g;i+=` C${e},${j} ${e},${k} ${d.x},${d.y}`}return i}function v(a,b){let c=a/2,d=.5*b,e=.03*a;return`M${c},${d} C${c+e},${d+(b-d)*.2} ${c-1.5*e},${d+(b-d)*.55} ${c+.5*e},${d+(b-d)*.75} C${c-e},${d+(b-d)*.85} ${c+.3*e},${d+(b-d)*.95} ${c},${b}`}function w(a,b,c,d){return`M${a-c},${b} A${c},${d} 0 1,1 ${a+c},${b} A${c},${d} 0 1,1 ${a-c},${b} Z`}(0,i.K)(q,"seededRandom"),(0,i.K)(r,"hashString"),(0,i.K)(s,"resolveSeed"),(0,i.K)(t,"generateFoldPath"),(0,i.K)(u,"generateHorizontalBoundary"),(0,i.K)(v,"generateCliffPath"),(0,i.K)(w,"generateConfusionPath");var x={complex:{model:"Probe → Sense → Respond",practice:"Emergent Practices"},complicated:{model:"Sense → Analyse → Respond",practice:"Good Practices"},clear:{model:"Sense → Categorise → Respond",practice:"Best Practices"},chaotic:{model:"Act → Sense → Respond",practice:"Novel Practices"},confusion:{model:"",practice:"Disorder"}},y=(0,i.K)((a,b)=>{let c=a/2,d=b/2;return{complex:{cx:c/2,cy:d/2,x:0,y:0,w:c,h:d},complicated:{cx:c+c/2,cy:d/2,x:c,y:0,w:c,h:d},chaotic:{cx:c/2,cy:d+d/2,x:0,y:d,w:c,h:d},clear:{cx:c+c/2,cy:d+d/2,x:c,y:d,w:c,h:d},confusion:{cx:c,cy:d,x:.7*c,y:.7*d,w:.6*c,h:.6*d}}},"getDomainLayouts"),z=(0,i.K)(()=>{let a=(0,g.P$)(),b=(0,g.zj)();return(0,f.$t)(a,b.themeVariables).cynefin},"getCynefinDomainColors"),A=(0,i.K)((a,b,c,d)=>{let f=d.db,i=f.getDomains(),j=f.getTransitions(),k=f.getDiagramTitle(),l=f.getAccTitle(),m=f.getAccDescription(),n=f.getConfig(),o=z();h.R.debug("Rendering Cynefin diagram");let p=n.width,q=n.height,r=n.padding,A=n.showDomainDescriptions,B=n.boundaryAmplitude,C=p+2*r,D=q+2*r,E={complex:o.complexBg,complicated:o.complicatedBg,clear:o.clearBg,chaotic:o.chaoticBg,confusion:o.confusionBg},F=(0,e.D)(b);(0,g.a$)(F,D,C,n.useMaxWidth??!0),F.attr("viewBox",`0 0 ${C} ${D}`),l&&F.append("title").text(l),m&&F.append("desc").text(m);let G=F.append("g").attr("transform",`translate(${r}, ${r})`),H=y(p,q),I=s(n.seed,b),J=G.append("g").attr("class","cynefin-backgrounds"),K=["complex","complicated","chaotic","clear"];for(let a of K){let b=H[a];J.append("rect").attr("class","cynefinDomain").attr("x",b.x).attr("y",b.y).attr("width",b.w).attr("height",b.h).attr("fill",E[a]).attr("fill-opacity",.4).attr("stroke","none")}let L=G.append("g").attr("class","cynefin-boundaries");L.append("path").attr("class","cynefinBoundary").attr("d",t(p,q,I,B)).attr("fill","none"),L.append("path").attr("class","cynefinBoundary").attr("d",u(p,q,I+100,B)).attr("fill","none"),L.append("path").attr("class","cynefinCliff").attr("d",v(p,q)).attr("fill","none");let M=.15*p,N=.15*q;G.append("path").attr("class","cynefinConfusion").attr("d",w(p/2,q/2,M,N)).attr("fill",E.confusion).attr("fill-opacity",.5);let O=G.append("g").attr("class","cynefin-labels");for(let a of K){let b=H[a];O.append("text").attr("class","cynefinDomainLabel").attr("x",b.cx).attr("y",A?b.cy-30:b.cy).attr("text-anchor","middle").attr("dominant-baseline","middle").text(a.charAt(0).toUpperCase()+a.slice(1))}if(O.append("text").attr("class","cynefinDomainLabel").attr("x",p/2).attr("y",A?q/2-10:q/2).attr("text-anchor","middle").attr("dominant-baseline","middle").text("Confusion"),A){let a=G.append("g").attr("class","cynefin-subtitles");for(let b of K){let c=H[b],d=x[b];a.append("text").attr("class","cynefinSubtitle").attr("x",c.cx).attr("y",c.cy-10).attr("text-anchor","middle").attr("dominant-baseline","middle").text(d.model),a.append("text").attr("class","cynefinSubtitle").attr("x",c.cx).attr("y",c.cy+5).attr("text-anchor","middle").attr("dominant-baseline","middle").text(d.practice)}a.append("text").attr("class","cynefinSubtitle").attr("x",p/2).attr("y",q/2+8).attr("text-anchor","middle").attr("dominant-baseline","middle").text(x.confusion.practice)}let P=G.append("g").attr("class","cynefin-items");for(let a of["complex","complicated","chaotic","clear","confusion"]){let b,c=i.get(a);if(!c||0===c.items.length)continue;let d=H[a],e="confusion"===a,f=c.items,g=0;if(e&&c.items.length>3&&(g=c.items.length-3,f=c.items.slice(0,3)),e){let a=A?22:14;b=d.cy+a}else b=d.cy+(A?25:15);if([...f].forEach((c,e)=>{let f=b+30*e,g=P.append("g"),h=g.append("text").attr("class","cynefinItemText").attr("x",0).attr("y",13).attr("text-anchor","middle").attr("dominant-baseline","central").text(c.label),i=7*c.label.length,j=h.node();if(j&&"function"==typeof j.getBBox){let a=j.getBBox();a.width>0&&(i=a.width)}let k=i+20,l=d.cx-k/2;g.attr("transform",`translate(${l}, ${f})`),g.insert("rect","text").attr("class","cynefinItem").attr("x",0).attr("y",0).attr("width",k).attr("height",26).attr("rx",4).attr("ry",4).attr("fill",E[a]).attr("fill-opacity",.95),h.attr("x",k/2).attr("y",13)}),g>0){let c=b+30*f.length,e=`+${g} more`,h=P.append("g"),i=h.append("text").attr("class","cynefinItemText").attr("x",0).attr("y",13).attr("text-anchor","middle").attr("dominant-baseline","central").text(e),j=7*e.length,k=i.node();if(k&&"function"==typeof k.getBBox){let a=k.getBBox();a.width>0&&(j=a.width)}let l=j+20,m=d.cx-l/2;h.attr("transform",`translate(${m}, ${c})`),h.insert("rect","text").attr("class","cynefinItemOverflow").attr("x",0).attr("y",0).attr("width",l).attr("height",26).attr("rx",4).attr("ry",4).attr("fill",E[a]).attr("fill-opacity",.6),i.attr("x",l/2).attr("y",13)}}if(j.length>0){let a=F.select("defs").empty()?F.append("defs"):F.select("defs"),c=`cynefin-arrow-${b}`;a.append("marker").attr("id",c).attr("viewBox","0 0 10 10").attr("refX",9).attr("refY",5).attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto-start-reverse").append("path").attr("d","M 0 0 L 10 5 L 0 10 z").attr("class","cynefinArrowHead");let d=G.append("g").attr("class","cynefin-arrows");j.forEach(a=>{let b=H[a.from],e=H[a.to];if(!b||!e)return;if(a.from===a.to)return void h.R.warn(`Cynefin renderer: skipping self-loop on domain "${a.from}"`);let f=b.cx,g=b.cy,i=e.cx,j=e.cy,k=i-f,l=j-g,m=Math.sqrt(k*k+l*l),n=.15*m,o=(f+i)/2+-l/m*n,p=(g+j)/2+k/m*n;d.append("path").attr("class","cynefinArrowLine").attr("d",`M${f},${g} Q${o},${p} ${i},${j}`).attr("fill","none").attr("marker-end",`url(#${c})`),a.label&&d.append("text").attr("class","cynefinArrowLabel").attr("x",o).attr("y",p-6).attr("text-anchor","middle").attr("dominant-baseline","auto").text(a.label)})}k&&G.append("text").attr("class","cynefinTitle").attr("x",p/2).attr("y",-r/2).attr("text-anchor","middle").attr("dominant-baseline","middle").text(k)},"draw"),B=(0,i.K)(()=>{let a=(0,g.P$)(),b=(0,g.zj)();return(0,f.$t)(a,b.themeVariables).cynefin},"getCynefinTheme"),C={parser:p,db:n,renderer:{draw:A},styles:(0,i.K)(()=>{let a=B();return`
	.cynefinDomain {
		stroke: none;
	}
	.cynefinDomainLabel {
		font-size: ${a.domainFontSize}px;
		font-weight: bold;
		fill: ${a.labelColor};
	}
	.cynefinSubtitle {
		font-size: ${a.itemFontSize-1}px;
		fill: ${a.textColor};
		font-style: italic;
	}
	.cynefinItem {
		fill-opacity: 0.95;
		stroke: ${a.boundaryColor};
		stroke-width: 1;
	}
	.cynefinItemText {
		font-size: ${a.itemFontSize}px;
		fill: ${a.textColor};
	}
	.cynefinItemOverflow {
		fill-opacity: 0.6;
		stroke: ${a.boundaryColor};
		stroke-width: 1;
		stroke-dasharray: 3 2;
	}
	.cynefinBoundary {
		stroke: ${a.boundaryColor};
		stroke-width: ${a.boundaryWidth};
		stroke-dasharray: 6 3;
	}
	.cynefinCliff {
		stroke: ${a.cliffColor};
		stroke-width: ${a.cliffWidth};
	}
	.cynefinConfusion {
		stroke: ${a.boundaryColor};
		stroke-width: 1.5;
		stroke-dasharray: 4 2;
	}
	.cynefinArrowLine {
		stroke: ${a.arrowColor};
		stroke-width: ${a.arrowWidth};
		fill: none;
	}
	.cynefinArrowHead {
		fill: ${a.arrowColor};
		stroke: none;
	}
	.cynefinArrowLabel {
		font-size: ${a.itemFontSize-1}px;
		fill: ${a.textColor};
	}
	.cynefinTitle {
		font-size: ${a.domainFontSize+2}px;
		font-weight: bold;
		fill: ${a.labelColor};
	}
	`},"styles")}}};