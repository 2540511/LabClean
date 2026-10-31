#define _CRT_SECURE_NO_WARNINGS
#include <graphics.h>
#include <stdio.h>
#include <tchar.h>
#include <conio.h>

#define MAX_GOODS 100
#define MAX_CART 100
#define MAX_INPUT 20

struct Product {
    int id;
    TCHAR name[25];
    float jiage;
};

struct Product products[MAX_GOODS] = {
    {101, _T("xuskdke"), 399.00},
    {102, _T("jfjjfjffjj"), 455.00},
    {0, _T(""), 0}
};

int bianhao[MAX_CART];
int bianhaocount = 0;

void kehuduan();
void showMessage(const TCHAR* msg, const TCHAR* title);
int showInputDialog(const TCHAR* prompt, TCHAR* buffer, int maxLen);
int showNumberInputDialog(const TCHAR* prompt);
void waitForKeyOrClick();

// 合并功能：查看商品 + 加入购物车 + 计算总价
void showAllInOne() {
    cleardevice();
    loadimage(NULL, _T("bg.bmp"), 0, 0, 1500, 900);
    settextstyle(24, 0, _T("宋体"));
    settextcolor(WHITE);

    // 标题
    outtextxy(100, 50, _T("===== 商品浏览｜一键加购｜实时结算 ====="));

    // 显示商品列表
    int y = 120;
    TCHAR str[200];
    for (int i = 0; i < MAX_GOODS; i++) {
        if (products[i].id == 0) break;
        _stprintf_s(str, _countof(str), _T("编号:%d  名称:%s  价格:%.2f元"),
            products[i].id, products[i].name, products[i].jiage);
        outtextxy(100, y, str);
        y += 40;
    }

    // 显示购物车 & 总价
    float total = 0;
    y += 30;
    outtextxy(100, y, _T("----- 已选商品 -----"));
    y += 40;

    for (int i = 0; i < bianhaocount; i++) {
        int id = bianhao[i];
        for (int j = 0; j < MAX_GOODS; j++) {
            if (products[j].id == id) {
                total += products[j].jiage;
                _stprintf_s(str, _countof(str), _T("%d. %s  %.2f元"),
                    i + 1, products[j].name, products[j].jiage);
                outtextxy(100, y, str);
                y += 35;
                break;
            }
        }
    }

    // 显示总价
    settextstyle(28, 0, _T("宋体"));
    settextcolor(YELLOW);
    _stprintf_s(str, _countof(str), _T("合计：%.2f 元"), total);
    outtextxy(100, y + 20, str);

    // 操作提示
    settextstyle(20, 0, _T("宋体"));
    settextcolor(WHITE);
    outtextxy(100, y + 70, _T("输入编号加入购物车 | 点击任意位置返回"));

    // 弹出输入框（自动在当前页面完成加购）
    TCHAR input[20] = { 0 };
    InputBox(input, 20, _T("请输入商品编号"), _T("加购"), _T(""));
    int cid = _ttoi(input);

    // 处理加购
    if (input[0] != _T('\0') && cid > 0) {
        int found = 0;
        for (int i = 0; i < MAX_GOODS; i++) {
            if (products[i].id == cid) {
                found = 1;
                if (bianhaocount < MAX_CART) {
                    bianhao[bianhaocount++] = cid;
                    showMessage(_T("加购成功！"), _T("提示"));
                } else {
                    showMessage(_T("购物车已满"), _T("提示"));
                }
                break;
            }
        }
        if (!found) {
            showMessage(_T("商品不存在"), _T("错误"));
        }
    }

    // 等待返回
    while (!MouseHit());
}

int main() {
    initgraph(1500, 900);
    setbkmode(TRANSPARENT);
    int choice = -1;
    MOUSEMSG m;

    while (1) {
        cleardevice();
        loadimage(NULL, _T("bg.bmp"), 0, 0, 1500, 900);

        settextstyle(36, 0, _T("宋体"));
        settextcolor(WHITE);
        outtextxy(500, 50, _T("===== 购物系统 ====="));

        setfillcolor(RGB(60, 60, 120));
        fillroundrect(500, 200, 1000, 300, 15, 15);
        fillroundrect(500, 350, 1000, 450, 15, 15);
        fillroundrect(500, 500, 1000, 600, 15, 15);

        settextstyle(28, 0, _T("宋体"));
        outtextxy(700, 235, _T("客 户 端"));
        outtextxy(700, 385, _T("管 理 端"));
        outtextxy(700, 535, _T("退 出 程 序"));

        while (MouseHit()) {
            m = GetMouseMsg();
            if (m.uMsg == WM_LBUTTONDOWN) {
                if (m.x >= 500 && m.x <= 1000 && m.y >= 200 && m.y <= 300) {
                    choice = 1; goto do_switch;
                }
                if (m.x >= 500 && m.x <= 1000 && m.y >= 350 && m.y <= 450) {
                    choice = 2; goto do_switch;
                }
                if (m.x >= 500 && m.x <= 1000 && m.y >= 500 && m.y <= 600) {
                    choice = 3; goto do_switch;
                }
            }
        }
        Sleep(10);
        continue;

    do_switch:
        switch (choice) {
            case 1: kehuduan(); break;
            case 2: showMessage(_T("管理端开发中"), _T("提示")); break;
            case 3: closegraph(); return 0;
        }
    }
}

// 新增：查看购物车功能
void showCart() {
    cleardevice();
    settextstyle(24, 0, _T("宋体"));
    settextcolor(BLACK);
    outtextxy(100, 50, _T("===== 我的购物车 ====="));

    int y = 120;
    TCHAR str[200];
    if (bianhaocount == 0) {
        outtextxy(100, y, _T("购物车是空的哦~"));
    }
    else {
        float total = 0;
        for (int i = 0; i < bianhaocount; i++) {
            int id = bianhao[i];
            for (int j = 0; j < MAX_GOODS; j++) {
                if (products[j].id == id) {
                    total += products[j].jiage;
                    _stprintf_s(str, _countof(str), _T("%d. 编号:%d  名称:%s  价格:%.2f元"),
                        i + 1, products[j].id, products[j].name, products[j].jiage);
                    outtextxy(100, y, str);
                    y += 40;
                    break;
                }
            }
        }
        settextstyle(28, 0, _T("宋体"));
        settextcolor(RED);
        _stprintf_s(str, _countof(str), _T("总价：%.2f 元"), total);
        outtextxy(100, y + 20, str);
    }

    outtextxy(100, y + 70, _T("按任意键返回"));
    waitForKeyOrClick();
}

// 修改后的 kehuduan() 函数（加入了查看购物车按钮）
void kehuduan() {
    int choice = -1;
    MOUSEMSG m;
    while (1) {
        cleardevice();
        loadimage(NULL, _T("bg.bmp"), 0, 0, 1500, 900);

        // 绘制三个按钮：1.商品购物 2.查看购物车 3.返回
        setfillcolor(RGB(40, 40, 80));
        // 按钮1：商品购物（三合一）
        fillroundrect(200, 150, 500, 220, 10, 10);
        // 按钮2：查看购物车（新增）
        fillroundrect(200, 280, 500, 350, 10, 10);
        // 按钮3：返回
        fillroundrect(200, 410, 500, 480, 10, 10);

        settextstyle(24, 0, _T("宋体"));
        settextcolor(WHITE);
        outtextxy(100, 50, _T("===== 购物车系统 ====="));
        outtextxy(250, 170, _T("1. 商品购物（三合一）"));
        outtextxy(250, 300, _T("2. 查看购物车")); // 新增
        outtextxy(250, 430, _T("0. 返回"));

        while (MouseHit()) {
            m = GetMouseMsg();
            if (m.uMsg == WM_LBUTTONDOWN) {
                bool b1 = (m.x > 200 && m.x < 500 && m.y > 150 && m.y < 220);
                bool b2 = (m.x > 200 && m.x < 500 && m.y > 280 && m.y < 350); // 新增按钮判断
                bool b0 = (m.x > 200 && m.x < 500 && m.y > 410 && m.y < 480);
                if (b1) choice = 1;
                if (b2) choice = 2; // 新增
                if (b0) choice = 0;
                goto do_switch;
            }
        }
        Sleep(10);
        continue;

    do_switch:
        switch (choice) {
        case 1: showAllInOne(); break;
        case 2: showCart(); break; // 绑定查看购物车功能
        case 0: return;
        }
    }
}


void showMessage(const TCHAR* msg, const TCHAR* title) {
    IMAGE bg; getimage(&bg, 0, 0, 1500, 900);
    setfillcolor(BLACK); solidrectangle(0, 0, 1500, 900);

    int dlgX = 450, dlgY = 300, w = 600, h = 300;
    setfillcolor(RGB(240,240,240));
    solidroundrect(dlgX, dlgY, dlgX+w, dlgY+h, 10,10);

    setfillcolor(RGB(0,120,215));
    solidroundrect(dlgX, dlgY, dlgX+w, dlgY+40,10,10);
    settextcolor(WHITE); settextstyle(20,0,_T("宋体"));
    outtextxy(dlgX+20, dlgY+10, title);

    settextcolor(BLACK); settextstyle(18,0,_T("宋体"));
    RECT r = {dlgX+30, dlgY+80, dlgX+w-30, dlgY+200};
    drawtext(msg, &r, DT_CENTER|DT_VCENTER|DT_WORDBREAK);

    setfillcolor(RGB(0,120,215));
    solidroundrect(dlgX+250, dlgY+240, dlgX+350, dlgY+275,5,5);
    settextcolor(WHITE);
    outtextxy(dlgX+285, dlgY+248, _T("确定"));

    MOUSEMSG m;
    while(1) {
        if(MouseHit()) {
            m = GetMouseMsg();
            if(m.uMsg==WM_LBUTTONDOWN && m.x>dlgX+250&&m.x<dlgX+350 && m.y>dlgY+240&&m.y<dlgY+275)
                break;
        }
        Sleep(10);
    }
    putimage(0,0,&bg);
}

int showInputDialog(const TCHAR* prompt, TCHAR* buffer, int maxLen) {
    IMAGE bg; getimage(&bg,0,0,1500,900);
    setfillcolor(BLACK); solidrectangle(0,0,1500,900);

    int x=400,y=300,w=700,h=300;
    setfillcolor(RGB(240,240,240)); solidroundrect(x,y,x+w,y+h,10,10);
    setfillcolor(RGB(0,120,215)); solidroundrect(x,y,x+w,y+40,10,10);

    settextcolor(WHITE); settextstyle(20,0,_T("宋体")); outtextxy(x+20,y+10,_T("输入"));
    settextcolor(BLACK); settextstyle(18,0,_T("宋体")); outtextxy(x+30,y+80,prompt);

    setfillcolor(WHITE); solidrectangle(x+30,y+120,x+w-30,y+170);
    int idx=0; buffer[0]=0; TCHAR show[MAX_INPUT+3]=_T("");
    int vis=1,fc=0; int res=0;
    MOUSEMSG m; char k;

    while(1) {
        fc++; if(fc%30==0) vis=!vis;
        setfillcolor(WHITE); solidrectangle(x+30,y+120,x+w-30,y+170);
        _stprintf_s(show,_countof(show),_T("%s"),buffer);
        if(vis && idx<maxLen) _tcscat_s(show,_countof(show),_T("|"));
        outtextxy(x+40,y+135,show);

        if(_kbhit()) {
            k=_getch();
            if(k==13){res=1;break;}
            if(k==8){if(idx>0)idx--,buffer[idx]=0;}
            if(k==27){res=0;break;}
            if(idx<maxLen-1&&k>=32)buffer[idx++]=k,buffer[idx]=0;
        }
        if(MouseHit()){
            m=GetMouseMsg();
            if(m.uMsg==WM_LBUTTONDOWN){
                if(m.x>x+250&&m.x<x+350&&m.y>y+240&&m.y<y+275){res=1;break;}
                if(m.x>x+380&&m.x<x+480&&m.y>y+240&&m.y<y+275){res=0;break;}
            }
        }
        Sleep(10);
    }
    putimage(0,0,&bg);
    return res;
}

int showNumberInputDialog(const TCHAR* prompt) {
    TCHAR buf[MAX_INPUT]=_T("");
    if(showInputDialog(prompt,buf,MAX_INPUT))return _ttoi(buf);
    return -1;
}

void waitForKeyOrClick() {
    MOUSEMSG m;
    while(1){
        if(_kbhit()){_getch();break;}
        if(MouseHit()){m=GetMouseMsg();if(m.uMsg==WM_LBUTTONDOWN)break;}
        Sleep(10);
    }
}
