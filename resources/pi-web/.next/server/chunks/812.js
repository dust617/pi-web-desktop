"use strict";exports.id=812,exports.ids=[812],exports.modules={78151:(a,b,c)=>{c.d(b,{P:()=>f});var d=c(46629),e=c(21143),f=(0,e.K2)((a,b,c,f)=>{a.attr("class",c);let{width:i,height:j,x:k,y:l}=g(a,b);(0,d.a$)(a,j,i,f);let m=h(k,l,i,j,b);a.attr("viewBox",m),e.Rm.debug(`viewBox configured: ${m} with padding: ${b}`)},"setupViewPortForSVG"),g=(0,e.K2)((a,b)=>{let c=a.node()?.getBBox()||{width:0,height:0,x:0,y:0};return{width:c.width+2*b,height:c.height+2*b,x:c.x,y:c.y}},"calculateDimensionsWithPadding"),h=(0,e.K2)((a,b,c,d,e)=>`${a-e} ${b-e} ${c} ${d}`,"createViewBox")},80339:(a,b,c)=>{c.d(b,{A:()=>f});var d=c(21143),e=c(69085),f=(0,d.K2)((a,b)=>{let c;return"sandbox"===b&&(c=(0,e.Ltv)("#i"+a)),("sandbox"===b?(0,e.Ltv)(c.nodes()[0].contentDocument.body):(0,e.Ltv)("body")).select(`[id="${a}"]`)},"getDiagramElement")},80812:(a,b,c)=>{c.d(b,{Zk:()=>k,q7:()=>M,tM:()=>ac,u4:()=>ab});var d=c(80339),e=c(78151),f=c(60426),g=c(40684),h=c(46629),i=c(21143),j=function(){var a=(0,i.K2)(function(a,b,c,d){for(c=c||{},d=a.length;d--;c[a[d]]=b);return c},"o"),b=[1,2],c=[1,3],d=[1,4],e=[2,4],f=[1,9],g=[1,11],h=[1,16],j=[1,17],k=[1,18],l=[1,19],m=[1,33],n=[1,20],o=[1,21],p=[1,22],q=[1,23],r=[1,24],s=[1,26],t=[1,27],u=[1,28],v=[1,29],w=[1,30],x=[1,31],y=[1,32],z=[1,35],A=[1,36],B=[1,37],C=[1,38],D=[1,34],E=[1,4,5,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],F=[1,4,5,14,15,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,39,40,41,45,48,51,52,53,54,57],G=[4,5,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],H={trace:(0,i.K2)(function(){},"trace"),yy:{},symbols_:{error:2,start:3,SPACE:4,NL:5,SD:6,document:7,line:8,statement:9,classDefStatement:10,styleStatement:11,cssClassStatement:12,idStatement:13,DESCR:14,"--\x3e":15,HIDE_EMPTY:16,scale:17,WIDTH:18,COMPOSIT_STATE:19,STRUCT_START:20,STRUCT_STOP:21,STATE_DESCR:22,AS:23,ID:24,FORK:25,JOIN:26,CHOICE:27,CONCURRENT:28,note:29,notePosition:30,NOTE_TEXT:31,direction:32,acc_title:33,acc_title_value:34,acc_descr:35,acc_descr_value:36,acc_descr_multiline_value:37,CLICK:38,STRING:39,HREF:40,classDef:41,CLASSDEF_ID:42,CLASSDEF_STYLEOPTS:43,DEFAULT:44,style:45,STYLE_IDS:46,STYLEDEF_STYLEOPTS:47,class:48,CLASSENTITY_IDS:49,STYLECLASS:50,direction_tb:51,direction_bt:52,direction_rl:53,direction_lr:54,eol:55,";":56,EDGE_STATE:57,STYLE_SEPARATOR:58,left_of:59,right_of:60,$accept:0,$end:1},terminals_:{2:"error",4:"SPACE",5:"NL",6:"SD",14:"DESCR",15:"--\x3e",16:"HIDE_EMPTY",17:"scale",18:"WIDTH",19:"COMPOSIT_STATE",20:"STRUCT_START",21:"STRUCT_STOP",22:"STATE_DESCR",23:"AS",24:"ID",25:"FORK",26:"JOIN",27:"CHOICE",28:"CONCURRENT",29:"note",31:"NOTE_TEXT",33:"acc_title",34:"acc_title_value",35:"acc_descr",36:"acc_descr_value",37:"acc_descr_multiline_value",38:"CLICK",39:"STRING",40:"HREF",41:"classDef",42:"CLASSDEF_ID",43:"CLASSDEF_STYLEOPTS",44:"DEFAULT",45:"style",46:"STYLE_IDS",47:"STYLEDEF_STYLEOPTS",48:"class",49:"CLASSENTITY_IDS",50:"STYLECLASS",51:"direction_tb",52:"direction_bt",53:"direction_rl",54:"direction_lr",56:";",57:"EDGE_STATE",58:"STYLE_SEPARATOR",59:"left_of",60:"right_of"},productions_:[0,[3,2],[3,2],[3,2],[7,0],[7,2],[8,2],[8,1],[8,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,3],[9,4],[9,1],[9,2],[9,1],[9,4],[9,3],[9,6],[9,1],[9,1],[9,1],[9,1],[9,4],[9,4],[9,1],[9,2],[9,2],[9,1],[9,5],[9,5],[10,3],[10,3],[11,3],[12,3],[32,1],[32,1],[32,1],[32,1],[55,1],[55,1],[13,1],[13,1],[13,3],[13,3],[30,1],[30,1]],performAction:(0,i.K2)(function(a,b,c,d,e,f,g){var h=f.length-1;switch(e){case 3:return d.setRootDoc(f[h]),f[h];case 4:this.$=[];break;case 5:"nl"!=f[h]&&(f[h-1].push(f[h]),this.$=f[h-1]);break;case 6:case 7:case 12:this.$=f[h];break;case 8:this.$="nl";break;case 13:let i=f[h-1];i.description=d.trimColon(f[h]),this.$=i;break;case 14:this.$={stmt:"relation",state1:f[h-2],state2:f[h]};break;case 15:let j=d.trimColon(f[h]);this.$={stmt:"relation",state1:f[h-3],state2:f[h-1],description:j};break;case 19:this.$={stmt:"state",id:f[h-3],type:"default",description:"",doc:f[h-1]};break;case 20:var k=f[h],l=f[h-2].trim();if(f[h].match(":")){var m=f[h].split(":");k=m[0],l=[l,m[1]]}this.$={stmt:"state",id:k,type:"default",description:l};break;case 21:this.$={stmt:"state",id:f[h-3],type:"default",description:f[h-5],doc:f[h-1]};break;case 22:this.$={stmt:"state",id:f[h],type:"fork"};break;case 23:this.$={stmt:"state",id:f[h],type:"join"};break;case 24:this.$={stmt:"state",id:f[h],type:"choice"};break;case 25:this.$={stmt:"state",id:d.getDividerId(),type:"divider"};break;case 26:this.$={stmt:"state",id:f[h-1].trim(),note:{position:f[h-2].trim(),text:f[h].trim()}};break;case 29:this.$=f[h].trim(),d.setAccTitle(this.$);break;case 30:case 31:this.$=f[h].trim(),d.setAccDescription(this.$);break;case 32:this.$={stmt:"click",id:f[h-3],url:f[h-2],tooltip:f[h-1]};break;case 33:this.$={stmt:"click",id:f[h-3],url:f[h-1],tooltip:""};break;case 34:case 35:this.$={stmt:"classDef",id:f[h-1].trim(),classes:f[h].trim()};break;case 36:this.$={stmt:"style",id:f[h-1].trim(),styleClass:f[h].trim()};break;case 37:this.$={stmt:"applyClass",id:f[h-1].trim(),styleClass:f[h].trim()};break;case 38:d.setDirection("TB"),this.$={stmt:"dir",value:"TB"};break;case 39:d.setDirection("BT"),this.$={stmt:"dir",value:"BT"};break;case 40:d.setDirection("RL"),this.$={stmt:"dir",value:"RL"};break;case 41:d.setDirection("LR"),this.$={stmt:"dir",value:"LR"};break;case 44:case 45:this.$={stmt:"state",id:f[h].trim(),type:"default",description:""};break;case 46:case 47:this.$={stmt:"state",id:f[h-2].trim(),classes:[f[h].trim()],type:"default",description:""}}},"anonymous"),table:[{3:1,4:b,5:c,6:d},{1:[3]},{3:5,4:b,5:c,6:d},{3:6,4:b,5:c,6:d},a([1,4,5,16,17,19,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],e,{7:7}),{1:[2,1]},{1:[2,2]},{1:[2,3],4:f,5:g,8:8,9:10,10:12,11:13,12:14,13:15,16:h,17:j,19:k,22:l,24:m,25:n,26:o,27:p,28:q,29:r,32:25,33:s,35:t,37:u,38:v,41:w,45:x,48:y,51:z,52:A,53:B,54:C,57:D},a(E,[2,5]),{9:39,10:12,11:13,12:14,13:15,16:h,17:j,19:k,22:l,24:m,25:n,26:o,27:p,28:q,29:r,32:25,33:s,35:t,37:u,38:v,41:w,45:x,48:y,51:z,52:A,53:B,54:C,57:D},a(E,[2,7]),a(E,[2,8]),a(E,[2,9]),a(E,[2,10]),a(E,[2,11]),a(E,[2,12],{14:[1,40],15:[1,41]}),a(E,[2,16]),{18:[1,42]},a(E,[2,18],{20:[1,43]}),{23:[1,44]},a(E,[2,22]),a(E,[2,23]),a(E,[2,24]),a(E,[2,25]),{30:45,31:[1,46],59:[1,47],60:[1,48]},a(E,[2,28]),{34:[1,49]},{36:[1,50]},a(E,[2,31]),{13:51,24:m,57:D},{42:[1,52],44:[1,53]},{46:[1,54]},{49:[1,55]},a(F,[2,44],{58:[1,56]}),a(F,[2,45],{58:[1,57]}),a(E,[2,38]),a(E,[2,39]),a(E,[2,40]),a(E,[2,41]),a(E,[2,6]),a(E,[2,13]),{13:58,24:m,57:D},a(E,[2,17]),a(G,e,{7:59}),{24:[1,60]},{24:[1,61]},{23:[1,62]},{24:[2,48]},{24:[2,49]},a(E,[2,29]),a(E,[2,30]),{39:[1,63],40:[1,64]},{43:[1,65]},{43:[1,66]},{47:[1,67]},{50:[1,68]},{24:[1,69]},{24:[1,70]},a(E,[2,14],{14:[1,71]}),{4:f,5:g,8:8,9:10,10:12,11:13,12:14,13:15,16:h,17:j,19:k,21:[1,72],22:l,24:m,25:n,26:o,27:p,28:q,29:r,32:25,33:s,35:t,37:u,38:v,41:w,45:x,48:y,51:z,52:A,53:B,54:C,57:D},a(E,[2,20],{20:[1,73]}),{31:[1,74]},{24:[1,75]},{39:[1,76]},{39:[1,77]},a(E,[2,34]),a(E,[2,35]),a(E,[2,36]),a(E,[2,37]),a(F,[2,46]),a(F,[2,47]),a(E,[2,15]),a(E,[2,19]),a(G,e,{7:78}),a(E,[2,26]),a(E,[2,27]),{5:[1,79]},{5:[1,80]},{4:f,5:g,8:8,9:10,10:12,11:13,12:14,13:15,16:h,17:j,19:k,21:[1,81],22:l,24:m,25:n,26:o,27:p,28:q,29:r,32:25,33:s,35:t,37:u,38:v,41:w,45:x,48:y,51:z,52:A,53:B,54:C,57:D},a(E,[2,32]),a(E,[2,33]),a(E,[2,21])],defaultActions:{5:[2,1],6:[2,2],47:[2,48],48:[2,49]},parseError:(0,i.K2)(function(a,b){if(b.recoverable)this.trace(a);else{var c=Error(a);throw c.hash=b,c}},"parseError"),parse:(0,i.K2)(function(a){var b=this,c=[0],d=[],e=[null],f=[],g=this.table,h="",j=0,k=0,l=0,m=f.slice.call(arguments,1),n=Object.create(this.lexer),o={};for(var p in this.yy)Object.prototype.hasOwnProperty.call(this.yy,p)&&(o[p]=this.yy[p]);n.setInput(a,o),o.lexer=n,o.parser=this,void 0===n.yylloc&&(n.yylloc={});var q=n.yylloc;f.push(q);var r=n.options&&n.options.ranges;function s(){var a;return"number"!=typeof(a=d.pop()||n.lex()||1)&&(a instanceof Array&&(a=(d=a).pop()),a=b.symbols_[a]||a),a}"function"==typeof o.parseError?this.parseError=o.parseError:this.parseError=Object.getPrototypeOf(this).parseError,(0,i.K2)(function(a){c.length=c.length-2*a,e.length=e.length-a,f.length=f.length-a},"popStack"),(0,i.K2)(s,"lex");for(var t,u,v,w,x,y,z,A,B,C={};;){if(v=c[c.length-1],this.defaultActions[v]?w=this.defaultActions[v]:(null==t&&(t=s()),w=g[v]&&g[v][t]),void 0===w||!w.length||!w[0]){var D="";for(y in B=[],g[v])this.terminals_[y]&&y>2&&B.push("'"+this.terminals_[y]+"'");D=n.showPosition?"Parse error on line "+(j+1)+":\n"+n.showPosition()+"\nExpecting "+B.join(", ")+", got '"+(this.terminals_[t]||t)+"'":"Parse error on line "+(j+1)+": Unexpected "+(1==t?"end of input":"'"+(this.terminals_[t]||t)+"'"),this.parseError(D,{text:n.match,token:this.terminals_[t]||t,line:n.yylineno,loc:q,expected:B})}if(w[0]instanceof Array&&w.length>1)throw Error("Parse Error: multiple actions possible at state: "+v+", token: "+t);switch(w[0]){case 1:c.push(t),e.push(n.yytext),f.push(n.yylloc),c.push(w[1]),t=null,u?(t=u,u=null):(k=n.yyleng,h=n.yytext,j=n.yylineno,q=n.yylloc,l>0&&l--);break;case 2:if(z=this.productions_[w[1]][1],C.$=e[e.length-z],C._$={first_line:f[f.length-(z||1)].first_line,last_line:f[f.length-1].last_line,first_column:f[f.length-(z||1)].first_column,last_column:f[f.length-1].last_column},r&&(C._$.range=[f[f.length-(z||1)].range[0],f[f.length-1].range[1]]),void 0!==(x=this.performAction.apply(C,[h,k,j,o,w[1],e,f].concat(m))))return x;z&&(c=c.slice(0,-1*z*2),e=e.slice(0,-1*z),f=f.slice(0,-1*z)),c.push(this.productions_[w[1]][0]),e.push(C.$),f.push(C._$),A=g[c[c.length-2]][c[c.length-1]],c.push(A);break;case 3:return!0}}return!0},"parse")};function I(){this.yy={}}return H.lexer={EOF:1,parseError:(0,i.K2)(function(a,b){if(this.yy.parser)this.yy.parser.parseError(a,b);else throw Error(a)},"parseError"),setInput:(0,i.K2)(function(a,b){return this.yy=b||this.yy||{},this._input=a,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},"setInput"),input:(0,i.K2)(function(){var a=this._input[0];return this.yytext+=a,this.yyleng++,this.offset++,this.match+=a,this.matched+=a,a.match(/(?:\r\n?|\n).*/g)?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),a},"input"),unput:(0,i.K2)(function(a){var b=a.length,c=a.split(/(?:\r\n?|\n)/g);this._input=a+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-b),this.offset-=b;var d=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),c.length-1&&(this.yylineno-=c.length-1);var e=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:c?(c.length===d.length?this.yylloc.first_column:0)+d[d.length-c.length].length-c[0].length:this.yylloc.first_column-b},this.options.ranges&&(this.yylloc.range=[e[0],e[0]+this.yyleng-b]),this.yyleng=this.yytext.length,this},"unput"),more:(0,i.K2)(function(){return this._more=!0,this},"more"),reject:(0,i.K2)(function(){return this.options.backtrack_lexer?(this._backtrack=!0,this):this.parseError("Lexical error on line "+(this.yylineno+1)+". You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).\n"+this.showPosition(),{text:"",token:null,line:this.yylineno})},"reject"),less:(0,i.K2)(function(a){this.unput(this.match.slice(a))},"less"),pastInput:(0,i.K2)(function(){var a=this.matched.substr(0,this.matched.length-this.match.length);return(a.length>20?"...":"")+a.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:(0,i.K2)(function(){var a=this.match;return a.length<20&&(a+=this._input.substr(0,20-a.length)),(a.substr(0,20)+(a.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:(0,i.K2)(function(){var a=this.pastInput(),b=Array(a.length+1).join("-");return a+this.upcomingInput()+"\n"+b+"^"},"showPosition"),test_match:(0,i.K2)(function(a,b){var c,d,e;if(this.options.backtrack_lexer&&(e={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(e.yylloc.range=this.yylloc.range.slice(0))),(d=a[0].match(/(?:\r\n?|\n).*/g))&&(this.yylineno+=d.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:d?d[d.length-1].length-d[d.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+a[0].length},this.yytext+=a[0],this.match+=a[0],this.matches=a,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(a[0].length),this.matched+=a[0],c=this.performAction.call(this,this.yy,this,b,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),c)return c;if(this._backtrack)for(var f in e)this[f]=e[f];return!1},"test_match"),next:(0,i.K2)(function(){if(this.done)return this.EOF;this._input||(this.done=!0),this._more||(this.yytext="",this.match="");for(var a,b,c,d,e=this._currentRules(),f=0;f<e.length;f++)if((c=this._input.match(this.rules[e[f]]))&&(!b||c[0].length>b[0].length)){if(b=c,d=f,this.options.backtrack_lexer){if(!1!==(a=this.test_match(c,e[f])))return a;if(!this._backtrack)return!1;b=!1;continue}if(!this.options.flex)break}return b?!1!==(a=this.test_match(b,e[d]))&&a:""===this._input?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+". Unrecognized text.\n"+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:(0,i.K2)(function(){var a=this.next();return a||this.lex()},"lex"),begin:(0,i.K2)(function(a){this.conditionStack.push(a)},"begin"),popState:(0,i.K2)(function(){return this.conditionStack.length-1>0?this.conditionStack.pop():this.conditionStack[0]},"popState"),_currentRules:(0,i.K2)(function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},"_currentRules"),topState:(0,i.K2)(function(a){return(a=this.conditionStack.length-1-Math.abs(a||0))>=0?this.conditionStack[a]:"INITIAL"},"topState"),pushState:(0,i.K2)(function(a){this.begin(a)},"pushState"),stateStackSize:(0,i.K2)(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:(0,i.K2)(function(a,b,c,d){switch(c){case 0:return 38;case 1:return 40;case 2:return 39;case 3:return 44;case 4:case 45:return 51;case 5:case 46:return 52;case 6:case 47:return 53;case 7:case 48:return 54;case 8:case 9:case 11:case 12:case 13:case 14:case 57:case 59:case 65:break;case 10:case 80:return 5;case 15:case 35:return this.pushState("SCALE"),17;case 16:case 36:return 18;case 17:case 23:case 37:case 52:case 55:this.popState();break;case 18:return this.begin("acc_title"),33;case 19:return this.popState(),"acc_title_value";case 20:return this.begin("acc_descr"),35;case 21:return this.popState(),"acc_descr_value";case 22:this.begin("acc_descr_multiline");break;case 24:return"acc_descr_multiline_value";case 25:return this.pushState("CLASSDEF"),41;case 26:return this.popState(),this.pushState("CLASSDEFID"),"DEFAULT_CLASSDEF_ID";case 27:return this.popState(),this.pushState("CLASSDEFID"),42;case 28:return this.popState(),43;case 29:return this.pushState("CLASS"),48;case 30:return this.popState(),this.pushState("CLASS_STYLE"),49;case 31:return this.popState(),50;case 32:return this.pushState("STYLE"),45;case 33:return this.popState(),this.pushState("STYLEDEF_STYLES"),46;case 34:return this.popState(),47;case 38:this.pushState("STATE");break;case 39:case 42:return this.popState(),b.yytext=b.yytext.slice(0,-8).trim(),25;case 40:case 43:return this.popState(),b.yytext=b.yytext.slice(0,-8).trim(),26;case 41:case 44:return this.popState(),b.yytext=b.yytext.slice(0,-10).trim(),27;case 49:this.pushState("STATE_STRING");break;case 50:return this.pushState("STATE_ID"),"AS";case 51:case 67:return this.popState(),"ID";case 53:return"STATE_DESCR";case 54:return 19;case 56:return this.popState(),this.pushState("struct"),20;case 58:return this.popState(),21;case 60:return this.begin("NOTE"),29;case 61:return this.popState(),this.pushState("NOTE_ID"),59;case 62:return this.popState(),this.pushState("NOTE_ID"),60;case 63:this.popState(),this.pushState("FLOATING_NOTE");break;case 64:return this.popState(),this.pushState("FLOATING_NOTE_ID"),"AS";case 66:return"NOTE_TEXT";case 68:return this.popState(),this.pushState("NOTE_TEXT"),24;case 69:return this.popState(),b.yytext=b.yytext.substr(2).trim(),31;case 70:return this.popState(),b.yytext=b.yytext.slice(0,-8).trim(),31;case 71:case 72:return 6;case 73:return 16;case 74:return 57;case 75:return 24;case 76:return b.yytext=b.yytext.trim(),14;case 77:return 15;case 78:return 28;case 79:return 58;case 81:return"INVALID"}},"anonymous"),rules:[/^(?:click\b)/i,/^(?:href\b)/i,/^(?:"[^"]*")/i,/^(?:default\b)/i,/^(?:.*direction\s+TB[^\n]*)/i,/^(?:.*direction\s+BT[^\n]*)/i,/^(?:.*direction\s+RL[^\n]*)/i,/^(?:.*direction\s+LR[^\n]*)/i,/^(?:%%(?!\{)[^\n]*)/i,/^(?:[^\}]%%[^\n]*)/i,/^(?:[\n]+)/i,/^(?:[\s]+)/i,/^(?:((?!\n)\s)+)/i,/^(?:#[^\n]*)/i,/^(?:%[^\n]*)/i,/^(?:scale\s+)/i,/^(?:\d+)/i,/^(?:\s+width\b)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:classDef\s+)/i,/^(?:DEFAULT\s+)/i,/^(?:\w+\s+)/i,/^(?:[^\n]*)/i,/^(?:class\s+)/i,/^(?:(\w+)+((,\s*\w+)*))/i,/^(?:[^\n]*)/i,/^(?:style\s+)/i,/^(?:[\w,]+\s+)/i,/^(?:[^\n]*)/i,/^(?:scale\s+)/i,/^(?:\d+)/i,/^(?:\s+width\b)/i,/^(?:state\s+)/i,/^(?:.*<<fork>>)/i,/^(?:.*<<join>>)/i,/^(?:.*<<choice>>)/i,/^(?:.*\[\[fork\]\])/i,/^(?:.*\[\[join\]\])/i,/^(?:.*\[\[choice\]\])/i,/^(?:.*direction\s+TB[^\n]*)/i,/^(?:.*direction\s+BT[^\n]*)/i,/^(?:.*direction\s+RL[^\n]*)/i,/^(?:.*direction\s+LR[^\n]*)/i,/^(?:["])/i,/^(?:\s*as\s+)/i,/^(?:[^\n\{]*)/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:[^\n\s\{]+)/i,/^(?:\n)/i,/^(?:\{)/i,/^(?:%%(?!\{)[^\n]*)/i,/^(?:\})/i,/^(?:[\n])/i,/^(?:note\s+)/i,/^(?:left of\b)/i,/^(?:right of\b)/i,/^(?:")/i,/^(?:\s*as\s*)/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:[^\n]*)/i,/^(?:\s*[^:\n\s\-]+)/i,/^(?:\s*:[^:\n;]+)/i,/^(?:[\s\S]*?end note\b)/i,/^(?:stateDiagram\s+)/i,/^(?:stateDiagram-v2\s+)/i,/^(?:hide empty description\b)/i,/^(?:\[\*\])/i,/^(?:[^:\n\s\-\{]+)/i,/^(?:\s*:(?:[^:\n;]|:[^:\n;])+)/i,/^(?:-->)/i,/^(?:--)/i,/^(?::::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{LINE:{rules:[12,13],inclusive:!1},struct:{rules:[12,13,25,29,32,38,45,46,47,48,57,58,59,60,74,75,76,77,78,79],inclusive:!1},FLOATING_NOTE_ID:{rules:[67],inclusive:!1},FLOATING_NOTE:{rules:[64,65,66],inclusive:!1},NOTE_TEXT:{rules:[69,70],inclusive:!1},NOTE_ID:{rules:[68],inclusive:!1},NOTE:{rules:[61,62,63],inclusive:!1},STYLEDEF_STYLEOPTS:{rules:[],inclusive:!1},STYLEDEF_STYLES:{rules:[34],inclusive:!1},STYLE_IDS:{rules:[],inclusive:!1},STYLE:{rules:[33],inclusive:!1},CLASS_STYLE:{rules:[31],inclusive:!1},CLASS:{rules:[30],inclusive:!1},CLASSDEFID:{rules:[28],inclusive:!1},CLASSDEF:{rules:[26,27],inclusive:!1},acc_descr_multiline:{rules:[23,24],inclusive:!1},acc_descr:{rules:[21],inclusive:!1},acc_title:{rules:[19],inclusive:!1},SCALE:{rules:[16,17,36,37],inclusive:!1},ALIAS:{rules:[],inclusive:!1},STATE_ID:{rules:[51],inclusive:!1},STATE_STRING:{rules:[52,53],inclusive:!1},FORK_STATE:{rules:[],inclusive:!1},STATE:{rules:[12,13,39,40,41,42,43,44,49,50,54,55,56],inclusive:!1},ID:{rules:[12,13],inclusive:!1},INITIAL:{rules:[0,1,2,3,4,5,6,7,8,9,10,11,13,14,15,18,20,22,25,29,32,35,38,56,60,71,72,73,74,75,76,77,79,80,81],inclusive:!0}}},(0,i.K2)(I,"Parser"),I.prototype=H,H.Parser=I,new I}();j.parser=j;var k=j,l="TB",m="state",n="root",o="relation",p="default",q="divider",r="fill:none",s="fill: #333",t="markdown",u="normal",v="rect",w="rectWithTitle",x="divider",y="roundedWithTitle",z="statediagram",A=`${z}-state`,B="transition",C=`${B} note-edge`,D=`${z}-note`,E=`${z}-cluster`,F=`${z}-cluster-alt`,G="parent",H="note",I="----",J=`${I}${H}`,K=`${I}${G}`,L=(0,i.K2)((a,b=l)=>{if(!a.doc)return b;let c=b;for(let b of a.doc)"dir"===b.stmt&&(c=b.value);return c},"getDir"),M={getClasses:(0,i.K2)(function(a,b){return b.db.getClasses()},"getClasses"),draw:(0,i.K2)(async function(a,b,c,j){i.Rm.info("REF0:"),i.Rm.info("Drawing state diagram (v2)",b);let{securityLevel:k,state:l,layout:m}=(0,h.D7)();j.db.extract(j.db.getRootDocV2());let n=j.db.getData(),o=(0,d.A)(b,k);n.type=j.type,n.layoutAlgorithm=m,n.nodeSpacing=l?.nodeSpacing||50,n.rankSpacing=l?.rankSpacing||50,"neo"===(0,h.D7)().look?n.markers=["barbNeo"]:n.markers=["barb"],n.diagramId=b,await (0,f.XX)(n,o);try{("function"==typeof j.db.getLinks?j.db.getLinks():new Map).forEach((a,b)=>{let c,d="string"==typeof b?b:"string"==typeof b?.id?b.id:"";if(!d)return void i.Rm.warn("⚠️ Invalid or missing stateId from key:",JSON.stringify(b));let e=o.node()?.querySelectorAll("g");if(e?.forEach(a=>{a.textContent?.trim()===d&&(c=a)}),!c)return void i.Rm.warn("⚠️ Could not find node matching text:",d);let f=c.parentNode;if(!f)return void i.Rm.warn("⚠️ Node has no parent, cannot wrap:",d);let g=document.createElementNS("http://www.w3.org/2000/svg","a"),h=a.url.replace(/^"+|"+$/g,"");if(g.setAttributeNS("http://www.w3.org/1999/xlink","xlink:href",h),g.setAttribute("target","_blank"),a.tooltip){let b=a.tooltip.replace(/^"+|"+$/g,"");g.setAttribute("title",b)}f.replaceChild(g,c),g.appendChild(c),i.Rm.info("\uD83D\uDD17 Wrapped node in <a> tag for:",d,a.url)})}catch(a){i.Rm.error("❌ Error injecting clickable links:",a)}g._K.insertTitle(o,"statediagramTitleText",l?.titleTopMargin??25,j.db.getDiagramTitle()),(0,e.P)(o,8,z,l?.useMaxWidth??!0)},"draw"),getDir:L},N=new Map,O=0;function P(a="",b=0,c="",d=I){let e=null!==c&&c.length>0?`${d}${c}`:"";return`state-${a}${e}-${b}`}(0,i.K2)(P,"stateDomId");var Q=(0,i.K2)((a,b,c,d,e,f,g,j)=>{i.Rm.trace("items",b),b.forEach(b=>{switch(b.stmt){case m:case p:V(a,b,c,d,e,f,g,j);break;case o:{V(a,b.state1,c,d,e,f,g,j),V(a,b.state2,c,d,e,f,g,j);let i="neo"===g,k={id:"edge"+O,start:b.state1.id,end:b.state2.id,arrowhead:"normal",arrowTypeEnd:i?"arrow_barb_neo":"arrow_barb",style:r,labelStyle:"",label:h.Y2.sanitizeText(b.description??"",(0,h.D7)()),arrowheadStyle:s,labelpos:"c",labelType:t,thickness:u,classes:B,look:g};e.push(k),O++}}})},"setupDoc"),R=(0,i.K2)((a,b=l)=>{let c=b;if(a.doc)for(let b of a.doc)"dir"===b.stmt&&(c=b.value);return c},"getDir");function S(a,b,c){if(!b.id||"</join></fork>"===b.id||"</choice>"===b.id)return;b.cssClasses&&(Array.isArray(b.cssCompiledStyles)||(b.cssCompiledStyles=[]),b.cssClasses.split(" ").forEach(a=>{let d=c.get(a);d&&(b.cssCompiledStyles=[...b.cssCompiledStyles??[],...d.styles])}));let d=a.find(a=>a.id===b.id);d?Object.assign(d,b):a.push(b)}function T(a){return a?.classes?.join(" ")??""}function U(a){return a?.styles??[]}(0,i.K2)(S,"insertOrUpdateNode"),(0,i.K2)(T,"getClassesFromDbInfo"),(0,i.K2)(U,"getStylesFromDbInfo");var V=(0,i.K2)((a,b,c,d,e,f,g,j)=>{let k=b.id,l=c.get(k),m=T(l),n=U(l),o=(0,h.D7)();if(i.Rm.info("dataFetcher parsedItem",b,l,n),"root"!==k){let c=v;!0===b.start?c="stateStart":!1===b.start&&(c="stateEnd"),b.type!==p&&(c=b.type),N.get(k)||N.set(k,{id:k,shape:c,description:h.Y2.sanitizeText(k,o),cssClasses:`${m} ${A}`,cssStyles:n});let l=N.get(k);b.description&&(Array.isArray(l.description)?(l.shape=w,l.description.push(b.description)):l.description?.length&&l.description.length>0?(l.shape=w,l.description===k?l.description=[b.description]:l.description=[l.description,b.description]):(l.shape=v,l.description=b.description),l.description=h.Y2.sanitizeTextOrArray(l.description,o)),l.description?.length===1&&l.shape===w&&("group"===l.type?l.shape=y:l.shape=v),!l.type&&b.doc&&(i.Rm.info("Setting cluster for XCX",k,R(b)),l.type="group",l.isGroup=!0,l.dir=R(b),l.shape=b.type===q?x:y,l.cssClasses=`${l.cssClasses} ${E} ${f?F:""}`);let z={labelStyle:"",shape:l.shape,label:l.description,cssClasses:l.cssClasses,cssCompiledStyles:[],cssStyles:l.cssStyles,id:k,dir:l.dir,domId:P(k,O),type:l.type,isGroup:"group"===l.type,padding:8,rx:10,ry:10,look:g,labelType:"markdown"};if(z.shape===x&&(z.label=""),a&&"root"!==a.id&&(i.Rm.trace("Setting node ",k," to be child of its parent ",a.id),z.parentId=a.id),z.centerLabel=!0,b.note){let a={labelStyle:"",shape:"note",label:b.note.text,labelType:"markdown",cssClasses:D,cssStyles:[],cssCompiledStyles:[],id:k+J+"-"+O,domId:P(k,O,H),type:l.type,isGroup:"group"===l.type,padding:o.flowchart?.padding,look:g,position:b.note.position},c=k+K,f={labelStyle:"",shape:"noteGroup",label:b.note.text,cssClasses:l.cssClasses,cssStyles:[],id:k+K,domId:P(k,O,G),type:"group",isGroup:!0,padding:16,look:g,position:b.note.position};O++,f.id=c,a.parentId=c,S(d,f,j),S(d,a,j),S(d,z,j);let h=k,i=a.id;"left of"===b.note.position&&(h=a.id,i=k),e.push({id:h+"-"+i,start:h,end:i,arrowhead:"none",arrowTypeEnd:"",style:r,labelStyle:"",classes:C,arrowheadStyle:s,labelpos:"c",labelType:t,thickness:u,look:g})}else S(d,z,j)}b.doc&&(i.Rm.trace("Adding nodes children "),Q(b,b.doc,c,d,e,!f,g,j))},"dataFetcher"),W=(0,i.K2)(()=>{N.clear(),O=0},"reset"),X="start",Y="color",Z="fill",$=(0,i.K2)(()=>new Map,"newClassesList"),_=(0,i.K2)(()=>({relations:[],states:new Map,documents:{}}),"newDoc"),aa=(0,i.K2)(a=>JSON.parse(JSON.stringify(a)),"clone"),ab=class{constructor(a){this.version=a,this.nodes=[],this.edges=[],this.rootDoc=[],this.classes=$(),this.documents={root:_()},this.currentDocument=this.documents.root,this.startEndCount=0,this.dividerCnt=0,this.links=new Map,this.getAccTitle=h.iN,this.setAccTitle=h.SV,this.getAccDescription=h.m7,this.setAccDescription=h.EI,this.setDiagramTitle=h.ke,this.getDiagramTitle=h.ab,this.clear(),this.setRootDoc=this.setRootDoc.bind(this),this.getDividerId=this.getDividerId.bind(this),this.setDirection=this.setDirection.bind(this),this.trimColon=this.trimColon.bind(this)}static{(0,i.K2)(this,"StateDB")}static{this.relationType={AGGREGATION:0,EXTENSION:1,COMPOSITION:2,DEPENDENCY:3}}extract(a){for(let b of(this.clear(!0),Array.isArray(a)?a:a.doc))switch(b.stmt){case m:this.addState(b.id.trim(),b.type,b.doc,b.description,b.note);break;case o:this.addRelation(b.state1,b.state2,b.description);break;case"classDef":this.addStyleClass(b.id.trim(),b.classes);break;case"style":this.handleStyleDef(b);break;case"applyClass":this.setCssClass(b.id.trim(),b.styleClass);break;case"click":this.addLink(b.id,b.url,b.tooltip)}let b=this.getStates(),c=(0,h.D7)();for(let a of(W(),V(void 0,this.getRootDocV2(),b,this.nodes,this.edges,!0,c.look,this.classes),this.nodes))if(Array.isArray(a.label)){if(a.description=a.label.slice(1),a.isGroup&&a.description.length>0)throw Error(`Group nodes can only have label. Remove the additional description for node [${a.id}]`);a.label=a.label[0]}}handleStyleDef(a){let b=a.id.trim().split(","),c=a.styleClass.split(",");for(let a of b){let b=this.getState(a);if(!b){let c=a.trim();this.addState(c),b=this.getState(c)}b&&(b.styles=c.map(a=>a.replace(/;/g,"")?.trim()))}}setRootDoc(a){i.Rm.info("Setting root doc",a),this.rootDoc=a,1===this.version?this.extract(a):this.extract(this.getRootDocV2())}docTranslator(a,b,c){if(b.stmt===o){this.docTranslator(a,b.state1,!0),this.docTranslator(a,b.state2,!1);return}if(b.stmt===m&&("[*]"===b.id?(b.id=a.id+(c?"_start":"_end"),b.start=c):b.id=b.id.trim()),b.stmt!==n&&b.stmt!==m||!b.doc)return;let d=[],e=[];for(let a of b.doc)if(a.type===q){let b=aa(a);b.doc=aa(e),d.push(b),e=[]}else e.push(a);if(d.length>0&&e.length>0){let a={stmt:m,id:(0,g.$C)(),type:"divider",doc:aa(e)};d.push(aa(a)),b.doc=d}b.doc.forEach(a=>this.docTranslator(b,a,!0))}getRootDocV2(){return this.docTranslator({id:n,stmt:n},{id:n,stmt:n,doc:this.rootDoc},!0),{id:n,doc:this.rootDoc}}addState(a,b=p,c,d,e,f,g,j){let k=a?.trim();if(this.currentDocument.states.has(k)){let a=this.currentDocument.states.get(k);if(!a)throw Error(`State not found: ${k}`);a.doc||(a.doc=c),a.type||(a.type=b)}else i.Rm.info("Adding state ",k,d),this.currentDocument.states.set(k,{stmt:m,id:k,descriptions:[],type:b,doc:c,note:e,classes:[],styles:[],textStyles:[]});if(d&&(i.Rm.info("Setting state description",k,d),(Array.isArray(d)?d:[d]).forEach(a=>this.addDescription(k,a.trim()))),e){let a=this.currentDocument.states.get(k);if(!a)throw Error(`State not found: ${k}`);a.note=e,a.note.text=h.Y2.sanitizeText(a.note.text,(0,h.D7)())}f&&(i.Rm.info("Setting state classes",k,f),(Array.isArray(f)?f:[f]).forEach(a=>this.setCssClass(k,a.trim()))),g&&(i.Rm.info("Setting state styles",k,g),(Array.isArray(g)?g:[g]).forEach(a=>this.setStyle(k,a.trim()))),j&&(i.Rm.info("Setting state styles",k,g),(Array.isArray(j)?j:[j]).forEach(a=>this.setTextStyle(k,a.trim())))}clear(a){this.nodes=[],this.edges=[],this.documents={root:_()},this.currentDocument=this.documents.root,this.startEndCount=0,this.classes=$(),a||(this.links=new Map,(0,h.IU)())}getState(a){return this.currentDocument.states.get(a)}getStates(){return this.currentDocument.states}logDocuments(){i.Rm.info("Documents = ",this.documents)}getRelations(){return this.currentDocument.relations}addLink(a,b,c){this.links.set(a,{url:b,tooltip:c}),i.Rm.warn("Adding link",a,b,c)}getLinks(){return this.links}startIdIfNeeded(a=""){return"[*]"===a?(this.startEndCount++,`${X}${this.startEndCount}`):a}startTypeIfNeeded(a="",b=p){return"[*]"===a?X:b}endIdIfNeeded(a=""){return"[*]"===a?(this.startEndCount++,`end${this.startEndCount}`):a}endTypeIfNeeded(a="",b=p){return"[*]"===a?"end":b}addRelationObjs(a,b,c=""){let d=this.startIdIfNeeded(a.id.trim()),e=this.startTypeIfNeeded(a.id.trim(),a.type),f=this.startIdIfNeeded(b.id.trim()),g=this.startTypeIfNeeded(b.id.trim(),b.type);this.addState(d,e,a.doc,a.description,a.note,a.classes,a.styles,a.textStyles),this.addState(f,g,b.doc,b.description,b.note,b.classes,b.styles,b.textStyles),this.currentDocument.relations.push({id1:d,id2:f,relationTitle:h.Y2.sanitizeText(c,(0,h.D7)())})}addRelation(a,b,c){if("object"==typeof a&&"object"==typeof b)this.addRelationObjs(a,b,c);else if("string"==typeof a&&"string"==typeof b){let d=this.startIdIfNeeded(a.trim()),e=this.startTypeIfNeeded(a),f=this.endIdIfNeeded(b.trim()),g=this.endTypeIfNeeded(b);this.addState(d,e),this.addState(f,g),this.currentDocument.relations.push({id1:d,id2:f,relationTitle:c?h.Y2.sanitizeText(c,(0,h.D7)()):void 0})}}addDescription(a,b){let c=this.currentDocument.states.get(a),d=b.startsWith(":")?b.replace(":","").trim():b;c?.descriptions?.push(h.Y2.sanitizeText(d,(0,h.D7)()))}cleanupLabel(a){return a.startsWith(":")?a.slice(2).trim():a.trim()}getDividerId(){return this.dividerCnt++,`divider-id-${this.dividerCnt}`}addStyleClass(a,b=""){this.classes.has(a)||this.classes.set(a,{id:a,styles:[],textStyles:[]});let c=this.classes.get(a);b&&c&&b.split(",").forEach(a=>{let b=a.replace(/([^;]*);/,"$1").trim();if(RegExp(Y).exec(a)){let a=b.replace(Z,"bgFill").replace(Y,Z);c.textStyles.push(a)}c.styles.push(b)})}getClasses(){return this.classes}setCssClass(a,b){a.split(",").forEach(a=>{let c=this.getState(a);if(!c){let b=a.trim();this.addState(b),c=this.getState(b)}c?.classes?.push(b)})}setStyle(a,b){this.getState(a)?.styles?.push(b)}setTextStyle(a,b){this.getState(a)?.textStyles?.push(b)}getDirectionStatement(){return this.rootDoc.find(a=>"dir"===a.stmt)}getDirection(){return this.getDirectionStatement()?.value??"TB"}setDirection(a){let b=this.getDirectionStatement();b?b.value=a:this.rootDoc.unshift({stmt:"dir",value:a})}trimColon(a){return a.startsWith(":")?a.slice(1).trim():a.trim()}getData(){let a=(0,h.D7)();return{nodes:this.nodes,edges:this.edges,other:{},config:a,direction:L(this.getRootDocV2())}}getConfig(){return(0,h.D7)().state}},ac=(0,i.K2)(a=>`
defs [id$="-barbEnd"] {
    fill: ${a.transitionColor};
    stroke: ${a.transitionColor};
  }
g.stateGroup text {
  fill: ${a.nodeBorder};
  stroke: none;
  font-size: 10px;
}
g.stateGroup text {
  fill: ${a.textColor};
  stroke: none;
  font-size: 10px;

}
g.stateGroup .state-title {
  font-weight: bolder;
  fill: ${a.stateLabelColor};
}

g.stateGroup rect {
  fill: ${a.mainBkg};
  stroke: ${a.nodeBorder};
}

g.stateGroup line {
  stroke: ${a.lineColor};
  stroke-width: ${a.strokeWidth||1};
}

.transition {
  stroke: ${a.transitionColor};
  stroke-width: ${a.strokeWidth||1};
  fill: none;
}

.stateGroup .composit {
  fill: ${a.background};
  border-bottom: 1px
}

.stateGroup .alt-composit {
  fill: #e0e0e0;
  border-bottom: 1px
}

.state-note {
  stroke: ${a.noteBorderColor};
  fill: ${a.noteBkgColor};

  text {
    fill: ${a.noteTextColor};
    stroke: none;
    font-size: 10px;
  }
}

.stateLabel .box {
  stroke: none;
  stroke-width: 0;
  fill: ${a.mainBkg};
  opacity: 0.5;
}

.edgeLabel .label rect {
  fill: ${a.labelBackgroundColor};
  opacity: 0.5;
}
.edgeLabel {
  background-color: ${a.edgeLabelBackground};
  p {
    background-color: ${a.edgeLabelBackground};
  }
  rect {
    opacity: 0.5;
    background-color: ${a.edgeLabelBackground};
    fill: ${a.edgeLabelBackground};
  }
  text-align: center;
}
.edgeLabel .label text {
  fill: ${a.transitionLabelColor||a.tertiaryTextColor};
}
.label div .edgeLabel {
  color: ${a.transitionLabelColor||a.tertiaryTextColor};
}

.stateLabel text {
  fill: ${a.stateLabelColor};
  font-size: 10px;
  font-weight: bold;
}

.node circle.state-start {
  fill: ${a.specialStateColor};
  stroke: ${a.specialStateColor};
}

.node .fork-join {
  fill: ${a.specialStateColor};
  stroke: ${a.specialStateColor};
}

.node circle.state-end {
  fill: ${a.innerEndBackground};
  stroke: ${a.background};
  stroke-width: 1.5
}
.end-state-inner {
  fill: ${a.compositeBackground||a.background};
  // stroke: ${a.background};
  stroke-width: 1.5
}

.node rect {
  fill: ${a.stateBkg||a.mainBkg};
  stroke: ${a.stateBorder||a.nodeBorder};
  stroke-width: ${a.strokeWidth||1}px;
}
.node polygon {
  fill: ${a.mainBkg};
  stroke: ${a.stateBorder||a.nodeBorder};;
  stroke-width: ${a.strokeWidth||1}px;
}
[id$="-barbEnd"] {
  fill: ${a.lineColor};
}

.statediagram-cluster rect {
  fill: ${a.compositeTitleBackground};
  stroke: ${a.stateBorder||a.nodeBorder};
  stroke-width: ${a.strokeWidth||1}px;
}

.cluster-label, .nodeLabel {
  color: ${a.stateLabelColor};
  // line-height: 1;
}

.statediagram-cluster rect.outer {
  rx: 5px;
  ry: 5px;
}
.statediagram-state .divider {
  stroke: ${a.stateBorder||a.nodeBorder};
}

.statediagram-state .title-state {
  rx: 5px;
  ry: 5px;
}
.statediagram-cluster.statediagram-cluster .inner {
  fill: ${a.compositeBackground||a.background};
}
.statediagram-cluster.statediagram-cluster-alt .inner {
  fill: ${a.altBackground?a.altBackground:"#efefef"};
}

.statediagram-cluster .inner {
  rx:0;
  ry:0;
}

.statediagram-state rect.basic {
  rx: 5px;
  ry: 5px;
}
.statediagram-state rect.divider {
  stroke-dasharray: 10,10;
  fill: ${a.altBackground?a.altBackground:"#efefef"};
}

.note-edge {
  stroke-dasharray: 5;
}

.statediagram-note rect {
  fill: ${a.noteBkgColor};
  stroke: ${a.noteBorderColor};
  stroke-width: 1px;
  rx: 0;
  ry: 0;
}
.statediagram-note rect {
  fill: ${a.noteBkgColor};
  stroke: ${a.noteBorderColor};
  stroke-width: 1px;
  rx: 0;
  ry: 0;
}

.statediagram-note text {
  fill: ${a.noteTextColor};
}

.statediagram-note .nodeLabel {
  color: ${a.noteTextColor};
}
.statediagram .edgeLabel {
  color: red; // ${a.noteTextColor};
}

[id$="-dependencyStart"], [id$="-dependencyEnd"] {
  fill: ${a.lineColor};
  stroke: ${a.lineColor};
  stroke-width: ${a.strokeWidth||1};
}

.statediagramTitleText {
  text-anchor: middle;
  font-size: 18px;
  fill: ${a.textColor};
}

[data-look="neo"].statediagram-cluster rect {
  fill: ${a.mainBkg};
  stroke: ${a.useGradient?"url("+a.svgId+"-gradient)":a.stateBorder||a.nodeBorder};
  stroke-width: ${a.strokeWidth??1};
}
[data-look="neo"].statediagram-cluster rect.outer {
  rx: ${a.radius}px;
  ry: ${a.radius}px;
  filter: ${a.dropShadow?a.dropShadow.replace("url(#drop-shadow)",`url(${a.svgId}-drop-shadow)`):"none"}
}
`,"getStyles")}};