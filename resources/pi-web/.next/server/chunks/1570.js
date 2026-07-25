"use strict";exports.id=1570,exports.ids=[1570],exports.modules={4328:(a,b,c)=>{function d(a,b){a.accDescr&&b.setAccDescription?.(a.accDescr),a.accTitle&&b.setAccTitle?.(a.accTitle),a.title&&b.setDiagramTitle?.(a.title)}c.d(b,{S:()=>d}),(0,c(95097).K)(d,"populateCommonDb")},61570:(a,b,c)=>{c.d(b,{diagram:()=>s});var d=c(4328),e=c(77893),f=c(37879),g=c(36594),h=c(58715),i=c(95097),j=c(92325),k=g.UI.packet,l=class{constructor(){this.packet=[],this.setAccTitle=g.SV,this.getAccTitle=g.iN,this.setDiagramTitle=g.ke,this.getDiagramTitle=g.ab,this.getAccDescription=g.m7,this.setAccDescription=g.EI}static{(0,i.K)(this,"PacketDB")}getConfig(){let a=(0,f.$t)({...k,...(0,g.zj)().packet});return a.showBits&&(a.paddingY+=10),a}getPacket(){return this.packet}pushWord(a){a.length>0&&this.packet.push(a)}clear(){(0,g.IU)(),this.packet=[]}},m=(0,i.K)((a,b)=>{(0,d.S)(a,b);let c=-1,e=[],f=1,{bitsPerRow:g}=b.getConfig();for(let{start:d,end:i,bits:j,label:k}of a.blocks){if(void 0!==d&&void 0!==i&&i<d)throw Error(`Packet block ${d} - ${i} is invalid. End must be greater than start.`);if((d??=c+1)!==c+1)throw Error(`Packet block ${d} - ${i??d} is not contiguous. It should start from ${c+1}.`);if(0===j)throw Error(`Packet block ${d} is invalid. Cannot have a zero bit field.`);for(i??=d+(j??1)-1,j??=i-d+1,c=i,h.R.debug(`Packet block ${d} - ${c} with label ${k}`);e.length<=g+1&&b.getPacket().length<1e4;){let[a,c]=n({start:d,end:i,bits:j,label:k},f,g);if(e.push(a),a.end+1===f*g&&(b.pushWord(e),e=[],f++),!c)break;({start:d,end:i,bits:j,label:k}=c)}}b.pushWord(e)},"populate"),n=(0,i.K)((a,b,c)=>{if(void 0===a.start)throw Error("start should have been set during first phase");if(void 0===a.end)throw Error("end should have been set during first phase");if(a.start>a.end)throw Error(`Block start ${a.start} is greater than block end ${a.end}.`);if(a.end+1<=b*c)return[a,void 0];let d=b*c-1,e=b*c;return[{start:a.start,end:d,label:a.label,bits:d-a.start},{start:e,end:a.end,label:a.label,bits:a.end-e}]},"getNextFittingBlock"),o={parser:{yy:void 0},parse:(0,i.K)(async a=>{let b=await (0,j.qg)("packet",a),c=o.parser?.yy;if(!(c instanceof l))throw Error("parser.parser?.yy was not a PacketDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.");h.R.debug(b),m(b,c)},"parse")},p=(0,i.K)((a,b,c,d)=>{let f=d.db,h=f.getConfig(),{rowHeight:i,paddingY:j,bitWidth:k,bitsPerRow:l}=h,m=f.getPacket(),n=f.getDiagramTitle(),o=i+j,p=o*(m.length+1)-(n?0:i),r=k*l+2,s=(0,e.D)(b);for(let[a,b]of(s.attr("viewBox",`0 0 ${r} ${p}`),(0,g.a$)(s,p,r,h.useMaxWidth),m.entries()))q(s,b,a,h);s.append("text").text(n).attr("x",r/2).attr("y",p-o/2).attr("dominant-baseline","middle").attr("text-anchor","middle").attr("class","packetTitle")},"draw"),q=(0,i.K)((a,b,c,{rowHeight:d,paddingX:e,paddingY:f,bitWidth:g,bitsPerRow:h,showBits:i})=>{let j=a.append("g"),k=c*(d+f)+f;for(let a of b){let b=a.start%h*g+1,c=(a.end-a.start+1)*g-e;if(j.append("rect").attr("x",b).attr("y",k).attr("width",c).attr("height",d).attr("class","packetBlock"),j.append("text").attr("x",b+c/2).attr("y",k+d/2).attr("class","packetLabel").attr("dominant-baseline","middle").attr("text-anchor","middle").text(a.label),!i)continue;let f=a.end===a.start,l=k-2;j.append("text").attr("x",b+(f?c/2:0)).attr("y",l).attr("class","packetByte start").attr("dominant-baseline","auto").attr("text-anchor",f?"middle":"start").text(a.start),f||j.append("text").attr("x",b+c).attr("y",l).attr("class","packetByte end").attr("dominant-baseline","auto").attr("text-anchor","end").text(a.end)}},"drawWord"),r={byteFontSize:"10px",startByteColor:"black",endByteColor:"black",labelColor:"black",labelFontSize:"12px",titleColor:"black",titleFontSize:"14px",blockStrokeColor:"black",blockStrokeWidth:"1",blockFillColor:"#efefef"},s={parser:o,get db(){return new l},renderer:{draw:p},styles:(0,i.K)(({packet:a}={})=>{let b=(0,f.$t)(r,a);return`
	.packetByte {
		font-size: ${b.byteFontSize};
	}
	.packetByte.start {
		fill: ${b.startByteColor};
	}
	.packetByte.end {
		fill: ${b.endByteColor};
	}
	.packetLabel {
		fill: ${b.labelColor};
		font-size: ${b.labelFontSize};
	}
	.packetTitle {
		fill: ${b.titleColor};
		font-size: ${b.titleFontSize};
	}
	.packetBlock {
		stroke: ${b.blockStrokeColor};
		stroke-width: ${b.blockStrokeWidth};
		fill: ${b.blockFillColor};
	}
	`},"styles")}}};