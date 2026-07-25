"use strict";exports.id=1792,exports.ids=[1792],exports.modules={4328:(a,b,c)=>{function d(a,b){a.accDescr&&b.setAccDescription?.(a.accDescr),a.accTitle&&b.setAccTitle?.(a.accTitle),a.title&&b.setDiagramTitle?.(a.title)}c.d(b,{S:()=>d}),(0,c(95097).K)(d,"populateCommonDb")},41792:(a,b,c)=>{c.d(b,{diagram:()=>B});var d=c(4328),e=c(77893),f=c(37879),g=c(36594),h=c(58715),i=c(95097),j=c(92325),k=c(69085),l=g.UI.pie,m={sections:new Map,showData:!1,config:l},n=m.sections,o=m.showData,p=structuredClone(l),q=(0,i.K)(()=>structuredClone(p),"getConfig"),r=(0,i.K)(()=>{n=new Map,o=m.showData,(0,g.IU)()},"clear"),s=(0,i.K)(({label:a,value:b})=>{if(b<0)throw Error(`"${a}" has invalid value: ${b}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);n.has(a)||(n.set(a,b),h.R.debug(`added new section: ${a}, with value: ${b}`))},"addSection"),t=(0,i.K)(()=>n,"getSections"),u=(0,i.K)(a=>{o=a},"setShowData"),v=(0,i.K)(()=>o,"getShowData"),w={getConfig:q,clear:r,setDiagramTitle:g.ke,getDiagramTitle:g.ab,setAccTitle:g.SV,getAccTitle:g.iN,setAccDescription:g.EI,getAccDescription:g.m7,addSection:s,getSections:t,setShowData:u,getShowData:v},x=(0,i.K)((a,b)=>{(0,d.S)(a,b),b.setShowData(a.showData),a.sections.map(b.addSection)},"populateDb"),y={parse:(0,i.K)(async a=>{let b=await (0,j.qg)("pie",a);h.R.debug(b),x(b,w)},"parse")},z=(0,i.K)(a=>`
  .pieCircle{
    stroke: ${a.pieStrokeColor};
    stroke-width : ${a.pieStrokeWidth};
    opacity : ${a.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${a.pieOuterStrokeColor};
    stroke-width: ${a.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${a.pieTitleTextSize};
    fill: ${a.pieTitleTextColor};
    font-family: ${a.fontFamily};
  }
  .slice {
    font-family: ${a.fontFamily};
    fill: ${a.pieSectionTextColor};
    font-size:${a.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${a.pieLegendTextColor};
    font-family: ${a.fontFamily};
    font-size: ${a.pieLegendTextSize};
  }
`,"getStyles"),A=(0,i.K)(a=>{let b=[...a.values()].reduce((a,b)=>a+b,0),c=[...a.entries()].map(([a,b])=>({label:a,value:b})).filter(a=>a.value/b*100>=1);return(0,k.rLf)().value(a=>a.value).sort(null)(c)},"createPieArcs"),B={parser:y,db:w,renderer:{draw:(0,i.K)((a,b,c,d)=>{h.R.debug("rendering pie chart\n"+a);let i=d.db,j=(0,g.D7)(),l=(0,f.$t)(i.getConfig(),j.pie),m=(0,e.D)(b),n=m.append("g");n.attr("transform","translate(225,225)");let{themeVariables:o}=j,[p]=(0,f.I5)(o.pieOuterStrokeWidth);p??=2;let q=l.legendPosition,r=l.textPosition,s=l.donutHole>0&&l.donutHole<=.9?l.donutHole:0,t=(0,k.JLW)().innerRadius(185*s).outerRadius(185),u=(0,k.JLW)().innerRadius(185*r).outerRadius(185*r),v=n.append("g");v.append("circle").attr("cx",0).attr("cy",0).attr("r",185+p/2).attr("class","pieOuterCircle");let w=i.getSections(),x=A(w),y=[o.pie1,o.pie2,o.pie3,o.pie4,o.pie5,o.pie6,o.pie7,o.pie8,o.pie9,o.pie10,o.pie11,o.pie12],z=0;w.forEach(a=>{z+=a});let B=x.filter(a=>"0"!==(a.data.value/z*100).toFixed(0)),C=(0,k.UMr)(y).domain([...w.keys()]);v.selectAll("mySlices").data(B).enter().append("path").attr("d",t).attr("fill",a=>C(a.data.label)).attr("class",a=>{let b="pieCircle";return"hover"===l.highlightSlice?b+=" highlightedOnHover":l.highlightSlice===a.data.label&&(b+=" highlighted"),b}),v.selectAll("mySlices").data(B).enter().append("text").text(a=>(a.data.value/z*100).toFixed(0)+"%").attr("transform",a=>"translate("+u.centroid(a)+")").style("text-anchor","middle").attr("class","slice");let D=n.append("text").text(i.getDiagramTitle()).attr("x",0).attr("y",-200).attr("class","pieTitleText"),E=[...w.entries()].map(([a,b])=>({label:a,value:b})),F=n.selectAll(".legend").data(E).enter().append("g").attr("class","legend");F.append("rect").attr("width",18).attr("height",18).style("fill",a=>C(a.label)).style("stroke",a=>C(a.label)),F.append("text").attr("x",22).attr("y",14).text(a=>i.getShowData()?`${a.label} [${a.value}]`:a.label);let G=Math.max(...F.selectAll("text").nodes().map(a=>a?.getBoundingClientRect().width??0)),H=450,I=490,J=22*E.length;switch(q){case"center":F.attr("transform",(a,b)=>"translate("+(-G/2-22)+","+(22*b-22*E.length/2)+")");break;case"top":H+=J,F.attr("transform",(a,b)=>`translate(${-G/2-22}, ${22*b-185})`),v.attr("transform",()=>`translate(0, ${J+22})`);break;case"bottom":H+=J,F.attr("transform",(a,b)=>"translate("+(-G/2-22)+","+(22*b- -207)+")");break;case"left":I+=22+G,F.attr("transform",(a,b)=>"translate(-207,"+(22*b-22*E.length/2)+")"),v.attr("transform",()=>`translate(${G+18+4}, 0)`);break;default:I+=22+G,F.attr("transform",(a,b)=>"translate(216,"+(22*b-22*E.length/2)+")")}let K=D.node()?.getBoundingClientRect().width??0,L=Math.min(0,225-K/2),M=Math.max(I,225+K/2)-L;m.attr("viewBox",`${L} 0 ${M} ${H}`),(0,g.a$)(m,H,M,l.useMaxWidth)},"draw")},styles:z}}};