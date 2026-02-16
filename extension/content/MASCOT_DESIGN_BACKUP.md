# Mascot Design Backup (Before Pupil Resize)
## Date: Feb 16, 2026

### Floating Icon (44px face)
```css
.wsn-face {
  width: 44px;
  height: 44px;
  background: #000;
  border-radius: 50%;
  position: relative;
  border: 1.5px solid #3a3a3a;
  box-shadow: 0 4.4px 9.2px rgba(0,0,0,0.25);
}
.wsn-floating-icon:hover .wsn-face {
  border-color: #4a4a4a;
  box-shadow: 0 6px 12px rgba(0,0,0,0.3);
}
.wsn-eye {
  width: 8px;
  height: 9px;
  background: white;
  border-radius: 50%;
  position: absolute;
  top: 14.5px;
  overflow: hidden;
}
.wsn-eye--left { left: calc(50% - 8px - 1.5px); }
.wsn-eye--right { left: calc(50% + 1.5px); }
.wsn-pupil {
  width: 3px;
  height: 3px;
  background: #000;
  border-radius: 50%;
  position: absolute;
  top: 48%;
  left: 48%;
  transform: translate(-50%, -50%);
  transition: transform 0.06s linear;
}
```

### Header Logo (24px face)
```css
.wsn-header-face {
  width: 24px;
  height: 24px;
  background: #000;
  border-radius: 50%;
  position: relative;
  border: 1px solid #3a3a3a;
  box-shadow: 0 2.4px 5px rgba(0,0,0,0.25);
}
.wsn-header-eye {
  width: 4.3px;
  height: 4.8px;
  background: white;
  border-radius: 50%;
  position: absolute;
  top: 7.9px;
}
.wsn-header-eye:first-child { left: calc(50% - 4.3px - 0.8px); }
.wsn-header-eye:last-child { left: calc(50% + 0.8px); }
/* No pupils in header version */
```
