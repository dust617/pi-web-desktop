"use strict";exports.id=3397,exports.ids=[3397],exports.modules={13397:(a,b,c)=>{c.d(b,{diagram:()=>A});var d=c(47596),e=c(93273),f=c(40684),g=c(46629),h=c(21143),i=c(92325),j=c(69085),k=g.UI.pie,l={sections:new Map,showData:!1,config:k},m=l.sections,n=l.showData,o=structuredClone(k),p=(0,h.K2)(()=>structuredClone(o),"getConfig"),q=(0,h.K2)(()=>{m=new Map,n=l.showData,(0,g.IU)()},"clear"),r=(0,h.K2)(({label:a,value:b})=>{if(b<0)throw Error(`"${a}" has invalid value: ${b}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);m.has(a)||(m.set(a,b),h.Rm.debug(`added new section: ${a}, with value: ${b}`))},"addSection"),s=(0,h.K2)(()=>m,"getSections"),t=(0,h.K2)(a=>{n=a},"setShowData"),u=(0,h.K2)(()=>n,"getShowData"),v={getConfig:p,clear:q,setDiagramTitle:g.ke,getDiagramTitle:g.ab,setAccTitle:g.SV,getAccTitle:g.iN,setAccDescription:g.EI,getAccDescription:g.m7,addSection:r,getSections:s,setShowData:t,getShowData:u},w=(0,h.K2)((a,b)=>{(0,e.S)(a,b),b.setShowData(a.showData),a.sections.map(b.addSection)},"populateDb"),x={parse:(0,h.K2)(async a=>{let b=await (0,i.qg)("pie",a);h.Rm.debug(b),w(b,v)},"parse")},y=(0,h.K2)(a=>`
  .pieCircle{
    stroke: ${a.pieStrokeColor};
    stroke-width : ${a.pieStrokeWidth};
    opacity : ${a.pieOpacity};
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
`,"getStyles"),z=(0,h.K2)(a=>{let b=[...a.values()].reduce((a,b)=>a+b,0),c=[...a.entries()].map(([a,b])=>({label:a,value:b})).filter(a=>a.value/b*100>=1);return(0,j.rLf)().value(a=>a.value).sort(null)(c)},"createPieArcs"),A={parser:x,db:v,renderer:{draw:(0,h.K2)((a,b,c,e)=>{h.Rm.debug("rendering pie chart\n"+a);let i=e.db,k=(0,g.D7)(),l=(0,f.$t)(i.getConfig(),k.pie),m=(0,d.D)(b),n=m.append("g");n.attr("transform","translate(225,225)");let{themeVariables:o}=k,[p]=(0,f.I5)(o.pieOuterStrokeWidth);p??=2;let q=l.textPosition,r=(0,j.JLW)().innerRadius(0).outerRadius(185),s=(0,j.JLW)().innerRadius(185*q).outerRadius(185*q);n.append("circle").attr("cx",0).attr("cy",0).attr("r",185+p/2).attr("class","pieOuterCircle");let t=i.getSections(),u=z(t),v=[o.pie1,o.pie2,o.pie3,o.pie4,o.pie5,o.pie6,o.pie7,o.pie8,o.pie9,o.pie10,o.pie11,o.pie12],w=0;t.forEach(a=>{w+=a});let x=u.filter(a=>"0"!==(a.data.value/w*100).toFixed(0)),y=(0,j.UMr)(v).domain([...t.keys()]);n.selectAll("mySlices").data(x).enter().append("path").attr("d",r).attr("fill",a=>y(a.data.label)).attr("class","pieCircle"),n.selectAll("mySlices").data(x).enter().append("text").text(a=>(a.data.value/w*100).toFixed(0)+"%").attr("transform",a=>"translate("+s.centroid(a)+")").style("text-anchor","middle").attr("class","slice");let A=n.append("text").text(i.getDiagramTitle()).attr("x",0).attr("y",-200).attr("class","pieTitleText"),B=[...t.entries()].map(([a,b])=>({label:a,value:b})),C=n.selectAll(".legend").data(B).enter().append("g").attr("class","legend").attr("transform",(a,b)=>"translate(216,"+(22*b-22*B.length/2)+")");C.append("rect").attr("width",18).attr("height",18).style("fill",a=>y(a.label)).style("stroke",a=>y(a.label)),C.append("text").attr("x",22).attr("y",14).text(a=>i.getShowData()?`${a.label} [${a.value}]`:a.label);let D=Math.max(...C.selectAll("text").nodes().map(a=>a?.getBoundingClientRect().width??0)),E=A.node()?.getBoundingClientRect().width??0,F=Math.min(0,225-E/2),G=Math.max(512+D,225+E/2)-F;m.attr("viewBox",`${F} 0 ${G} 450`),(0,g.a$)(m,450,G,l.useMaxWidth)},"draw")},styles:y}},93273:(a,b,c)=>{function d(a,b){a.accDescr&&b.setAccDescription?.(a.accDescr),a.accTitle&&b.setAccTitle?.(a.accTitle),a.title&&b.setDiagramTitle?.(a.title)}c.d(b,{S:()=>d}),(0,c(21143).K2)(d,"populateCommonDb")}};